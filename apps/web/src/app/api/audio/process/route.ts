import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_PROCESS_TIMEOUT_MS = 1000 * 60 * 10;

type ProcessMode = "enhance-voice" | "normalize-loudness";

function getFfmpegBinary() {
	return process.env.FFMPEG_BINARY || "ffmpeg";
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

async function runCommand({
	command,
	args,
	cwd,
	timeoutMs,
}: {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
}) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
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
				resolve();
				return;
			}

			reject(
				new Error(stderr || stdout || `${command} exited with code ${code}`),
			);
		});
	});
}

async function checkFfmpegAvailability() {
	try {
		await runCommand({
			command: getFfmpegBinary(),
			args: ["-version"],
			cwd: process.cwd(),
			timeoutMs: 8000,
		});
		return true;
	} catch {
		return false;
	}
}

function buildOutputName({
	inputName,
	mode,
}: {
	inputName: string;
	mode: ProcessMode;
}) {
	const suffix =
		mode === "enhance-voice" ? "_enhanced_voice.wav" : "_normalized.wav";
	return inputName.replace(/(\.[^.]+)?$/, suffix);
}

function buildFilterArg({
	mode,
	targetLufs,
}: {
	mode: ProcessMode;
	targetLufs: number;
}) {
	if (mode === "normalize-loudness") {
		return `loudnorm=I=${targetLufs}:LRA=11:TP=-1.5`;
	}

	return [
		"highpass=f=120",
		"lowpass=f=7200",
		"equalizer=f=2600:t=q:w=1.2:g=4",
		"acompressor=threshold=-18dB:ratio=2.5:attack=5:release=80:makeup=2",
		"alimiter=limit=-1dB",
	].join(",");
}

export async function GET() {
	const ffmpegAvailable = await checkFfmpegAvailability();

	return NextResponse.json({
		ffmpegAvailable,
		binary: getFfmpegBinary(),
		modes: [
			{ id: "enhance-voice", label: "Enhance Voice" },
			{ id: "normalize-loudness", label: "Normalize Loudness" },
		],
	});
}

export async function POST(request: Request) {
	const formData = await request.formData();
	const file = formData.get("file");
	const requestedMode = formData.get("mode");
	const targetLufsValue =
		typeof formData.get("targetLufs") === "string"
			? Number.parseFloat(formData.get("targetLufs") as string)
			: -16;

	if (!(file instanceof File)) {
		return new NextResponse("No file uploaded", { status: 400 });
	}

	const mode: ProcessMode =
		requestedMode === "normalize-loudness"
			? "normalize-loudness"
			: "enhance-voice";

	if (!(await checkFfmpegAvailability())) {
		return new NextResponse("ffmpeg is not installed or not on PATH.", {
			status: 500,
		});
	}

	const targetLufs = Number.isFinite(targetLufsValue) ? targetLufsValue : -16;
	const jobId = randomUUID();
	const workDir = path.join(os.tmpdir(), "gsmediacut-audio-process", jobId);
	await fs.mkdir(workDir, { recursive: true });

	try {
		const inputExtension = path.extname(file.name) || ".bin";
		const inputPath = path.join(workDir, `input${inputExtension}`);
		const outputPath = path.join(
			workDir,
			buildOutputName({
				inputName: file.name,
				mode,
			}),
		);
		await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

		await runCommand({
			command: getFfmpegBinary(),
			args: [
				"-y",
				"-i",
				inputPath,
				"-vn",
				"-ac",
				"2",
				"-ar",
				"44100",
				"-af",
				buildFilterArg({ mode, targetLufs }),
				outputPath,
			],
			cwd: workDir,
			timeoutMs: AUDIO_PROCESS_TIMEOUT_MS,
		});

		return NextResponse.json({
			mode,
			filename: path.basename(outputPath),
			mimeType: inferMimeType(outputPath),
			base64: (await fs.readFile(outputPath)).toString("base64"),
		});
	} catch (error) {
		console.error("Audio processing failed:", error);
		return new NextResponse(
			error instanceof Error ? error.message : "Audio processing failed",
			{ status: 500 },
		);
	} finally {
		await fs.rm(workDir, { recursive: true, force: true });
	}
}
