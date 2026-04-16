import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { hasRunpodConfig, submitRunpodSyncJob } from "@/lib/cloud/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseEngine(value: FormDataEntryValue | null) {
	if (value === "ai" || value === "veo") {
		return value;
	}

	return "fast";
}

async function resolveVendorFile(...segments: string[]) {
	const candidates = [
		path.resolve(process.cwd(), "vendor", ...segments),
		path.resolve(process.cwd(), "..", "vendor", ...segments),
		path.resolve(process.cwd(), "..", "..", "vendor", ...segments),
	];

	for (const candidate of candidates) {
		try {
			await fs.access(candidate);
			return candidate;
		} catch {}
	}

	return null;
}

async function resolveVeoExecutable() {
	const candidates = [
		["VeoWatermarkRemover", "GeminiWatermarkTool-Video.exe"],
		["VeoWatermarkRemover", "VeoWatermarkRemover.exe"],
	];

	for (const candidate of candidates) {
		const resolved = await resolveVendorFile(...candidate);
		if (resolved) {
			return resolved;
		}
	}

	return null;
}

function runFfmpeg(args: string[]) {
	return new Promise<void>((resolve, reject) => {
		const process = spawn("ffmpeg", args, {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});

		let stderr = "";
		process.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		process.on("error", reject);
		process.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(stderr || `ffmpeg exited with code ${code}`));
		});
	});
}

function buildPythonEnv(tempDir: string) {
	const homeDir = process.env.HOME ?? os.homedir();
	const username =
		process.env.USERNAME ??
		process.env.USER ??
		process.env.LOGNAME ??
		os.userInfo().username;
	const cacheRoot = path.join(tempDir, "python-cache");

	return {
		...process.env,
		HOME: homeDir,
		USERPROFILE: process.env.USERPROFILE ?? homeDir,
		USERNAME: username,
		USER: process.env.USER ?? username,
		LOGNAME: process.env.LOGNAME ?? username,
		TORCHINDUCTOR_CACHE_DIR:
			process.env.TORCHINDUCTOR_CACHE_DIR ??
			path.join(cacheRoot, "torchinductor"),
		TORCH_HOME: process.env.TORCH_HOME ?? path.join(cacheRoot, "torch"),
		XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? path.join(cacheRoot, "xdg"),
		PYTHONIOENCODING: "utf-8",
	};
}

function runCommand({
	command,
	args,
	cwd,
	env,
}: {
	command: string;
	args: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}) {
	return new Promise<void>((resolve, reject) => {
		const process = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			cwd,
			env,
		});

		let stdout = "";
		let stderr = "";
		process.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		process.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		process.on("error", reject);
		process.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(
				new Error(stderr || stdout || `${command} exited with code ${code}`),
			);
		});
	});
}

function parseRunpodVideoOutput(output: unknown) {
	if (!output || typeof output !== "object") {
		return null;
	}

	const record = output as Record<string, unknown>;
	const nestedOutput =
		record.output && typeof record.output === "object"
			? (record.output as Record<string, unknown>)
			: null;

	const base64Value =
		(typeof record.videoBase64 === "string" && record.videoBase64) ||
		(typeof record.video_base64 === "string" && record.video_base64) ||
		(typeof record.resultBase64 === "string" && record.resultBase64) ||
		(nestedOutput &&
			((typeof nestedOutput.videoBase64 === "string" &&
				nestedOutput.videoBase64) ||
				(typeof nestedOutput.video_base64 === "string" &&
					nestedOutput.video_base64) ||
				(typeof nestedOutput.resultBase64 === "string" &&
					nestedOutput.resultBase64))) ||
		null;

	const urlValue =
		(typeof record.videoUrl === "string" && record.videoUrl) ||
		(typeof record.video_url === "string" && record.video_url) ||
		(typeof record.url === "string" && record.url) ||
		(nestedOutput &&
			((typeof nestedOutput.videoUrl === "string" && nestedOutput.videoUrl) ||
				(typeof nestedOutput.video_url === "string" &&
					nestedOutput.video_url) ||
				(typeof nestedOutput.url === "string" && nestedOutput.url))) ||
		null;

	return { base64Value, urlValue };
}

async function runRunpodWatermark({
	file,
	fileBuffer,
	detectionPrompt,
	detectionSkip,
	fadeIn,
	fadeOut,
}: {
	file: File;
	fileBuffer: Buffer;
	detectionPrompt: string;
	detectionSkip: number;
	fadeIn: string;
	fadeOut: string;
}) {
	const result = await submitRunpodSyncJob({
		input: {
			task: "watermark_remove",
			engine: "watermarkremover-ai",
			filename: file.name,
			mimeType: file.type || "video/mp4",
			fileBase64: fileBuffer.toString("base64"),
			detectionPrompt,
			detectionSkip,
			fadeIn,
			fadeOut,
		},
	});

	const parsed = parseRunpodVideoOutput(result.output ?? result);
	if (!parsed) {
		throw new Error(
			"Runpod returned no usable video output. Expected videoBase64 or videoUrl in the result.",
		);
	}

	if (parsed.base64Value) {
		return Buffer.from(parsed.base64Value, "base64");
	}

	if (parsed.urlValue) {
		const response = await fetch(parsed.urlValue, { cache: "no-store" });
		if (!response.ok) {
			throw new Error(
				`Runpod returned a video URL but download failed with ${response.status}.`,
			);
		}

		return Buffer.from(await response.arrayBuffer());
	}

	throw new Error(
		"Runpod returned an unsupported output format. Expected videoBase64 or videoUrl.",
	);
}

export async function POST(request: Request) {
	const formData = await request.formData();
	const file = formData.get("file");
	const engine = parseEngine(formData.get("engine"));
	const x = parsePositiveInt(formData.get("x"));
	const y = parsePositiveInt(formData.get("y"));
	const width = parsePositiveInt(formData.get("width"));
	const height = parsePositiveInt(formData.get("height"));
	const detectionPrompt =
		typeof formData.get("detectionPrompt") === "string"
			? (formData.get("detectionPrompt") as string)
			: "watermark";
	const detectionSkip = parsePositiveInt(formData.get("detectionSkip")) ?? 2;
	const fadeIn =
		typeof formData.get("fadeIn") === "string" ? formData.get("fadeIn") : "0.2";
	const fadeOut =
		typeof formData.get("fadeOut") === "string"
			? formData.get("fadeOut")
			: "0.2";

	if (!(file instanceof File)) {
		return new NextResponse("No file uploaded", { status: 400 });
	}

	if (
		engine === "fast" &&
		([x, y, width, height].some((value) => value === null) || !width || !height)
	) {
		return new NextResponse("Invalid watermark region", { status: 400 });
	}

	const jobId = randomUUID();
	const tempDir = path.join(os.tmpdir(), "gsmediacut-watermark", jobId);
	await fs.mkdir(tempDir, { recursive: true });

	const inputExtension = path.extname(file.name) || ".mp4";
	const inputPath = path.join(tempDir, `input${inputExtension}`);
	const outputPath = path.join(tempDir, "output_cleaned.mp4");

	try {
		const inputBuffer = Buffer.from(await file.arrayBuffer());
		await fs.writeFile(inputPath, inputBuffer);

		if (engine === "ai") {
			if (hasRunpodConfig()) {
				const runpodBuffer = await runRunpodWatermark({
					file,
					fileBuffer: inputBuffer,
					detectionPrompt,
					detectionSkip: Math.min(Math.max(detectionSkip, 1), 10),
					fadeIn,
					fadeOut,
				});
				await fs.writeFile(outputPath, runpodBuffer);
			} else {
				const scriptPath = await resolveVendorFile(
					"WatermarkRemover-AI",
					"remwm.py",
				);
				const vendorRoot = await resolveVendorFile("WatermarkRemover-AI");
				if (!scriptPath) {
					return new NextResponse(
						"WatermarkRemover-AI script not found in vendor",
						{
							status: 500,
						},
					);
				}

				const pythonEnv = buildPythonEnv(tempDir);
				await fs.mkdir(pythonEnv.TORCHINDUCTOR_CACHE_DIR ?? tempDir, {
					recursive: true,
				});
				await fs.mkdir(pythonEnv.TORCH_HOME ?? tempDir, { recursive: true });
				await fs.mkdir(pythonEnv.XDG_CACHE_HOME ?? tempDir, {
					recursive: true,
				});

				await runCommand({
					command: "python",
					cwd: vendorRoot ?? path.dirname(scriptPath),
					env: pythonEnv,
					args: [
						scriptPath,
						inputPath,
						outputPath,
						"--overwrite",
						"--force-format",
						"MP4",
						"--detection-prompt",
						detectionPrompt,
						"--detection-skip",
						Math.min(Math.max(detectionSkip, 1), 10).toString(),
						"--fade-in",
						fadeIn,
						"--fade-out",
						fadeOut,
					],
				});
			}
		} else if (engine === "veo") {
			const executablePath = await resolveVeoExecutable();
			if (!executablePath) {
				return new NextResponse(
					"Veo Remove needs the release binary `GeminiWatermarkTool-Video.exe` inside vendor/VeoWatermarkRemover.",
					{ status: 500 },
				);
			}

			await runCommand({
				command: executablePath,
				cwd: path.dirname(executablePath),
				args: ["--veo", "-i", inputPath, "-o", outputPath],
			});
		} else {
			await runFfmpeg([
				"-y",
				"-i",
				inputPath,
				"-vf",
				`delogo=x=${x}:y=${y}:w=${width}:h=${height}:show=0`,
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				"18",
				"-c:a",
				"aac",
				"-movflags",
				"+faststart",
				outputPath,
			]);
		}

		const outputBuffer = await fs.readFile(outputPath);
		return new NextResponse(new Uint8Array(outputBuffer), {
			status: 200,
			headers: {
				"Content-Type": "video/mp4",
				"X-GSM-Engine": engine,
				"Content-Disposition": `inline; filename="${path.basename(file.name, inputExtension)}_cleaned.mp4"`,
			},
		});
	} catch (error) {
		console.error("Watermark processing failed:", error);
		return new NextResponse(
			error instanceof Error ? error.message : "Watermark processing failed",
			{ status: 500 },
		);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}
