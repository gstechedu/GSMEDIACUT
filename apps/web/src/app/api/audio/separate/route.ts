import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_MODEL_ALIASES: Record<string, string> = {
	"UVR-MDX-NET-Voc_FT": "UVR_MDXNET_Main.onnx",
	UVR_MDXNET_Main_390: "UVR_MDXNET_Main.onnx",
	"UVR-MDX-NET-Inst_HQ_3": "UVR-MDX-NET-Inst_HQ_3.onnx",
};
const AUDIO_SEPARATOR_TIMEOUT_MS = 1000 * 60 * 20;
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".m4a", ".ogg"]);

const MODEL_OPTIONS = [
	{ id: "UVR_MDXNET_Main.onnx", label: "MDX Main" },
	{ id: "UVR_MDXNET_1_9703.onnx", label: "MDX Vocal Focus" },
	{ id: "UVR-MDX-NET-Inst_HQ_3.onnx", label: "MDX Instrumental HQ" },
];
const SUPPORTED_MODEL_IDS = new Set(MODEL_OPTIONS.map((model) => model.id));
const DEFAULT_MODEL = normalizeModelName(
	process.env.AUDIO_SEPARATOR_DEFAULT_MODEL,
);

type StemOutput = {
	stemType: "vocals" | "instrumental" | "other";
	filename: string;
	mimeType: string;
	base64: string;
};

function normalizeModelName(modelName: string | null | undefined) {
	const normalized = modelName
		? (LEGACY_MODEL_ALIASES[modelName] ?? modelName)
		: MODEL_OPTIONS[0].id;
	return SUPPORTED_MODEL_IDS.has(normalized) ? normalized : MODEL_OPTIONS[0].id;
}

function getAudioSeparatorBinary() {
	return (
		process.env.AUDIO_SEPARATOR_BINARY ||
		(os.platform() === "win32" ? "audio-separator.exe" : "audio-separator")
	);
}

function inferMimeType(filePath: string) {
	switch (path.extname(filePath).toLowerCase()) {
		case ".wav":
			return "audio/wav";
		case ".flac":
			return "audio/flac";
		case ".ogg":
			return "audio/ogg";
		case ".m4a":
			return "audio/mp4";
		default:
			return "audio/mpeg";
	}
}

function inferStemType(filePath: string): StemOutput["stemType"] {
	const name = path.basename(filePath).toLowerCase();
	if (
		name.includes("vocals") ||
		name.includes("vocal") ||
		name.includes("voice")
	) {
		return "vocals";
	}
	if (
		name.includes("instrumental") ||
		name.includes("karaoke") ||
		name.includes("music") ||
		name.includes("no_vocals")
	) {
		return "instrumental";
	}
	return "other";
}

async function runCommand({
	command,
	args,
	cwd,
	timeoutMs,
	env,
}: {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	env?: NodeJS.ProcessEnv;
}) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(
				new Error(
					`Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
				),
			);
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			reject(
				new Error(stderr || stdout || `${command} exited with code ${code}`),
			);
		});
	});
}

function getAudioSeparatorEnv(workDir: string): NodeJS.ProcessEnv {
	const userProfile = process.env.USERPROFILE || os.homedir();
	const username =
		process.env.USERNAME ||
		process.env.USER ||
		path.basename(userProfile) ||
		"gsmediacut";
	const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir();

	return {
		...process.env,
		USERNAME: username,
		USER: process.env.USER || username,
		LOGNAME: process.env.LOGNAME || username,
		LNAME: process.env.LNAME || username,
		HOME: process.env.HOME || userProfile,
		USERPROFILE: userProfile,
		TMP: tempDir,
		TEMP: tempDir,
		TORCHINDUCTOR_CACHE_DIR: path.join(workDir, "torchinductor-cache"),
		XDG_CACHE_HOME: path.join(workDir, "xdg-cache"),
	};
}

async function checkAudioSeparatorAvailability() {
	try {
		await runCommand({
			command: getAudioSeparatorBinary(),
			args: ["--help"],
			cwd: process.cwd(),
			timeoutMs: 8000,
		});
		return true;
	} catch {
		return false;
	}
}

async function listAudioFiles(rootDir: string): Promise<string[]> {
	const entries = await fs.readdir(rootDir, { withFileTypes: true });
	const nestedFiles = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(rootDir, entry.name);
			if (entry.isDirectory()) {
				return listAudioFiles(entryPath);
			}
			if (
				entry.isFile() &&
				AUDIO_EXTENSIONS.has(path.extname(entryPath).toLowerCase())
			) {
				return [entryPath];
			}
			return [];
		}),
	);

	return nestedFiles.flat();
}

async function extractAudioFromVideo({
	inputPath,
	outputPath,
	workDir,
}: {
	inputPath: string;
	outputPath: string;
	workDir: string;
}) {
	await runCommand({
		command: "ffmpeg",
		args: [
			"-y",
			"-i",
			inputPath,
			"-vn",
			"-ac",
			"2",
			"-ar",
			"44100",
			outputPath,
		],
		cwd: workDir,
		timeoutMs: AUDIO_SEPARATOR_TIMEOUT_MS,
	});
}

function filterOutputsByMode({
	outputs,
	mode,
}: {
	outputs: StemOutput[];
	mode: "both" | "vocals" | "instrumental";
}) {
	if (mode === "both") {
		return outputs;
	}

	return outputs.filter((output) => output.stemType === mode);
}

function getSingleStemArg(mode: "both" | "vocals" | "instrumental") {
	switch (mode) {
		case "vocals":
			return "Vocals";
		case "instrumental":
			return "Instrumental";
		default:
			return null;
	}
}

export async function GET() {
	const available = await checkAudioSeparatorAvailability();

	return NextResponse.json({
		available,
		binary: getAudioSeparatorBinary(),
		defaultModel: DEFAULT_MODEL,
		models: MODEL_OPTIONS,
		installHint:
			"pip install audio-separator[gpu] then run `audio-separator input.mp3 -m UVR_MDXNET_Main.onnx`",
	});
}

export async function POST(request: Request) {
	const formData = await request.formData();
	const file = formData.get("file");
	const modelName = normalizeModelName(
		typeof formData.get("modelName") === "string"
			? (formData.get("modelName") as string)
			: DEFAULT_MODEL,
	);
	const outputMode =
		formData.get("outputMode") === "vocals" ||
		formData.get("outputMode") === "instrumental"
			? (formData.get("outputMode") as "vocals" | "instrumental")
			: "both";

	if (!(file instanceof File)) {
		return new NextResponse("No file uploaded", { status: 400 });
	}

	if (!(await checkAudioSeparatorAvailability())) {
		return new NextResponse(
			"audio-separator is not installed or not on PATH. Install with: pip install audio-separator[gpu]",
			{ status: 500 },
		);
	}

	const jobId = randomUUID();
	const workDir = path.join(os.tmpdir(), "gsmediacut-audio-separate", jobId);
	const modelDir = path.join(os.tmpdir(), "gsmediacut-audio-separator-models");
	await fs.mkdir(workDir, { recursive: true });
	await fs.mkdir(modelDir, { recursive: true });

	try {
		const inputExtension = path.extname(file.name) || ".bin";
		const inputPath = path.join(workDir, `input${inputExtension}`);
		await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

		const separatorInputPath = file.type.startsWith("video/")
			? path.join(workDir, "source-audio.wav")
			: inputPath;

		if (file.type.startsWith("video/")) {
			await extractAudioFromVideo({
				inputPath,
				outputPath: separatorInputPath,
				workDir,
			});
		}

		const beforeFiles = new Set(await listAudioFiles(workDir));
		const singleStemArg = getSingleStemArg(outputMode);
		await runCommand({
			command: getAudioSeparatorBinary(),
			args: [
				separatorInputPath,
				"-m",
				modelName,
				"--output_dir",
				workDir,
				"--model_file_dir",
				modelDir,
				"--output_format",
				"WAV",
				...(singleStemArg ? ["--single_stem", singleStemArg] : []),
			],
			cwd: workDir,
			env: getAudioSeparatorEnv(workDir),
			timeoutMs: AUDIO_SEPARATOR_TIMEOUT_MS,
		});

		const afterFiles = await listAudioFiles(workDir);
		const outputFiles = afterFiles.filter(
			(filePath) =>
				!beforeFiles.has(filePath) &&
				path.resolve(filePath) !== path.resolve(separatorInputPath) &&
				path.resolve(filePath) !== path.resolve(inputPath),
		);

		if (outputFiles.length === 0) {
			throw new Error(
				"audio-separator finished but no separated stem files were found.",
			);
		}

		const outputs = await Promise.all(
			outputFiles.map(async (filePath) => ({
				stemType: inferStemType(filePath),
				filename: path.basename(filePath),
				mimeType: inferMimeType(filePath),
				base64: (await fs.readFile(filePath)).toString("base64"),
			})),
		);

		const filteredOutputs = filterOutputsByMode({
			outputs,
			mode: outputMode,
		});

		if (filteredOutputs.length === 0) {
			throw new Error(
				`No ${outputMode} stem was produced by the selected model.`,
			);
		}

		return NextResponse.json({
			outputs: filteredOutputs,
			modelName,
			outputMode,
		});
	} catch (error) {
		console.error("Audio separation failed:", error);
		return new NextResponse(
			error instanceof Error ? error.message : "Audio separation failed",
			{ status: 500 },
		);
	} finally {
		await fs.rm(workDir, { recursive: true, force: true });
	}
}
