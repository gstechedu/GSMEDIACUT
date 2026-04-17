import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import {
	getRunpodJobStatus,
	hasRunpodConfig,
	submitRunpodJob,
} from "@/lib/cloud/runpod";
import {
	createSignedDownloadUrl,
	createSignedUploadUrl,
	deleteObject as deleteR2Object,
	hasR2Config,
	uploadTempObject,
} from "@/lib/cloud/r2";
import { webEnv } from "@/lib/env/web";
import {
	completeWatermarkProgress,
	failWatermarkProgress,
	initWatermarkProgress,
	updateWatermarkProgress,
} from "@/lib/watermark/progress-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNPOD_SAFE_RAW_UPLOAD_BYTES = 7 * 1024 * 1024;
const RUNPOD_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 2;
const PUBLIC_UPLOAD_DIR = path.join(os.tmpdir(), "gsmediacut-public-uploads");
const PREVIEW_TIMEOUT_MS = 1000 * 90;

type PreviewCacheEntry = {
	expiresAt: number;
	result: unknown;
};

declare global {
	var __gsmWatermarkPreviewCache: Map<string, PreviewCacheEntry> | undefined;
}

function getPreviewCache() {
	if (!globalThis.__gsmWatermarkPreviewCache) {
		globalThis.__gsmWatermarkPreviewCache = new Map();
	}

	return globalThis.__gsmWatermarkPreviewCache;
}

function parsePositiveInt(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseFastRegions(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) {
			return null;
		}

		const normalized = parsed
			.map((region) => {
				if (!region || typeof region !== "object") {
					return null;
				}

				const record = region as Record<string, unknown>;
				const x = Number.parseInt(String(record.x ?? ""), 10);
				const y = Number.parseInt(String(record.y ?? ""), 10);
				const width = Number.parseInt(String(record.width ?? ""), 10);
				const height = Number.parseInt(String(record.height ?? ""), 10);
				if (
					!Number.isFinite(x) ||
					!Number.isFinite(y) ||
					!Number.isFinite(width) ||
					!Number.isFinite(height) ||
					width <= 0 ||
					height <= 0
				) {
					return null;
				}

				return { x, y, width, height };
			})
			.filter((region): region is NonNullable<typeof region> =>
				Boolean(region),
			);

		return normalized.length > 0 ? normalized : null;
	} catch {
		return null;
	}
}

function parseEngine(value: FormDataEntryValue | null) {
	if (value === "ai") {
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

export async function GET() {
	const publicBaseUrl = getPublicBaseUrl();
	const aiTransport = hasR2Config()
		? "r2"
		: publicBaseUrl
			? "server-url"
			: "inline";

	return NextResponse.json({
		engines: {
			fast: { available: true },
			ai: {
				available: true,
				remote: hasRunpodConfig(),
				transport: aiTransport,
			},
		},
	});
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

function runFfprobe(args: string[]) {
	return new Promise<string>((resolve, reject) => {
		const process = spawn("ffprobe", args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
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
				resolve(stdout);
				return;
			}

			reject(new Error(stderr || `ffprobe exited with code ${code}`));
		});
	});
}

async function getVideoDimensions(filePath: string) {
	const stdout = await runFfprobe([
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height",
		"-of",
		"json",
		filePath,
	]);

	const parsed = JSON.parse(stdout) as {
		streams?: Array<{ width?: number; height?: number }>;
	};
	const stream = parsed.streams?.[0];
	const width = Number(stream?.width ?? 0);
	const height = Number(stream?.height ?? 0);

	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error("ffprobe returned invalid video dimensions.");
	}

	return { width, height };
}

function clampRegionsToVideo(
	regions: Array<{
		x: number;
		y: number;
		width: number;
		height: number;
	}> | null,
	videoSize: { width: number; height: number },
) {
	if (!regions || regions.length === 0) {
		return null;
	}

	const normalized = regions
		.map((region) => {
			const x = Math.max(
				0,
				Math.min(videoSize.width - 1, Math.round(region.x)),
			);
			const y = Math.max(
				0,
				Math.min(videoSize.height - 1, Math.round(region.y)),
			);
			const right = Math.max(
				x + 1,
				Math.min(videoSize.width, Math.round(region.x + region.width)),
			);
			const bottom = Math.max(
				y + 1,
				Math.min(videoSize.height, Math.round(region.y + region.height)),
			);
			const width = right - x;
			const height = bottom - y;

			if (width <= 0 || height <= 0) {
				return null;
			}

			return { x, y, width, height };
		})
		.filter((region): region is NonNullable<typeof region> => Boolean(region));

	return normalized.length > 0 ? normalized : null;
}

function makeDelogoSafeRegions(
	regions: Array<{
		x: number;
		y: number;
		width: number;
		height: number;
	}> | null,
	videoSize: { width: number; height: number },
) {
	if (!regions || regions.length === 0) {
		return null;
	}

	const normalized = regions
		.map((region) => {
			if (videoSize.width <= 2 || videoSize.height <= 2) {
				return null;
			}

			const x = Math.max(1, Math.min(videoSize.width - 2, region.x));
			const y = Math.max(1, Math.min(videoSize.height - 2, region.y));
			const right = Math.max(
				x + 1,
				Math.min(videoSize.width - 1, region.x + region.width),
			);
			const bottom = Math.max(
				y + 1,
				Math.min(videoSize.height - 1, region.y + region.height),
			);
			const width = right - x;
			const height = bottom - y;

			if (width <= 0 || height <= 0) {
				return null;
			}

			return { x, y, width, height };
		})
		.filter((region): region is NonNullable<typeof region> => Boolean(region));

	return normalized.length > 0 ? normalized : null;
}

function parseOverallProgressFromLine(line: string) {
	const match = line.match(/overall_progress:(\d+)%/i);
	if (!match) {
		return null;
	}

	const parsed = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(parsed) ? parsed : null;
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
	onStdoutLine,
	onStderrLine,
}: {
	command: string;
	args: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	onStdoutLine?: (line: string) => void;
	onStderrLine?: (line: string) => void;
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
		let stdoutBuffer = "";
		let stderrBuffer = "";
		process.stdout.on("data", (chunk) => {
			const value = chunk.toString();
			stdout += value;
			stdoutBuffer += value;
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				onStdoutLine?.(line);
			}
		});
		process.stderr.on("data", (chunk) => {
			const value = chunk.toString();
			stderr += value;
			stderrBuffer += value;
			const lines = stderrBuffer.split(/\r?\n/);
			stderrBuffer = lines.pop() ?? "";
			for (const line of lines) {
				onStderrLine?.(line);
			}
		});

		process.on("error", reject);
		process.on("close", (code) => {
			if (stdoutBuffer) {
				onStdoutLine?.(stdoutBuffer);
			}
			if (stderrBuffer) {
				onStderrLine?.(stderrBuffer);
			}
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

function runCommandCapture({
	command,
	args,
	cwd,
	env,
	timeoutMs,
}: {
	command: string;
	args: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const process = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			cwd,
			env,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeoutId =
			typeof timeoutMs === "number" && timeoutMs > 0
				? setTimeout(() => {
						if (settled) {
							return;
						}
						settled = true;
						process.kill();
						reject(
							new Error(
								`Preview detection timed out after ${Math.round(
									timeoutMs / 1000,
								)} seconds.`,
							),
						);
					}, timeoutMs)
				: null;
		process.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		process.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		process.on("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			reject(error);
		});
		process.on("close", (code) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
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

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadBufferWithRetry(url: string, attempts = 8) {
	let lastStatus = 0;

	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const response = await fetch(url, { cache: "no-store" });
		if (response.ok) {
			return Buffer.from(await response.arrayBuffer());
		}

		lastStatus = response.status;
		if (response.status !== 404 && response.status !== 403) {
			throw new Error(`Download failed with ${response.status}.`);
		}

		await sleep(1000);
	}

	throw new Error(`Download failed with ${lastStatus}.`);
}

function getPublicBaseUrl() {
	const candidate =
		webEnv.SERVER_PUBLIC_BASE_URL ?? webEnv.NEXT_PUBLIC_SITE_URL ?? null;
	if (!candidate) {
		return null;
	}

	const parsed = new URL(candidate);
	if (
		parsed.hostname === "localhost" ||
		parsed.hostname === "127.0.0.1" ||
		parsed.hostname === "::1"
	) {
		return null;
	}

	return parsed.toString().replace(/\/$/, "");
}

function isRemoteAiMode(aiMode: string) {
	return (
		aiMode === "runpod" || aiMode === "runpod-r2" || aiMode === "runpod-url"
	);
}

function shouldFallbackToLocalAi(error: unknown) {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message;
	return (
		message === "RUNPOD_BODY_LIMIT_EXCEEDED" ||
		message.includes("Florence2ForConditionalGeneration") ||
		(message.includes("cannot import name") &&
			message.includes("transformers")) ||
		message.includes(
			"from transformers import AutoProcessor, Florence2ForConditionalGeneration",
		)
	);
}

function getLocalAiFallbackReason(error: Error) {
	if (error.message === "RUNPOD_BODY_LIMIT_EXCEEDED") {
		return "Runpod rejected the inline upload size, so AI fell back to local processing.";
	}

	if (
		error.message.includes("Florence2ForConditionalGeneration") ||
		(error.message.includes("cannot import name") &&
			error.message.includes("transformers"))
	) {
		return "Runpod worker is using an incompatible transformers build, so AI fell back to local processing.";
	}

	return "Runpod failed, so AI fell back to local processing.";
}

async function createRunpodSourceUpload({
	file,
	fileBuffer,
}: {
	file: File;
	fileBuffer: Buffer;
}) {
	const publicBaseUrl = getPublicBaseUrl();
	if (!publicBaseUrl) {
		return null;
	}

	const uploadId = randomUUID();
	const token = randomUUID();
	const extension = path.extname(file.name) || ".mp4";
	const filePath = path.join(PUBLIC_UPLOAD_DIR, `${uploadId}${extension}`);
	const metadataPath = path.join(PUBLIC_UPLOAD_DIR, `${uploadId}.json`);

	await fs.mkdir(PUBLIC_UPLOAD_DIR, { recursive: true });
	await fs.writeFile(filePath, fileBuffer);
	await fs.writeFile(
		metadataPath,
		JSON.stringify({
			token,
			filePath,
			contentType: file.type || "video/mp4",
			fileName: file.name,
		}),
	);

	return {
		filePath,
		metadataPath,
		sourceUrl: `${publicBaseUrl}/api/uploads/watermark/${uploadId}?token=${encodeURIComponent(token)}`,
	};
}

async function cleanupRunpodSourceUpload(
	upload:
		| {
				filePath: string;
				metadataPath: string;
		  }
		| null
		| undefined,
) {
	if (!upload) {
		return;
	}

	await fs.rm(upload.filePath, { force: true });
	await fs.rm(upload.metadataPath, { force: true });
}

async function createRunpodR2Upload({
	file,
	fileBuffer,
}: {
	file: File;
	fileBuffer: Buffer;
}) {
	const extension = path.extname(file.name) || ".mp4";
	const uploadId = randomUUID();
	const key = `temp-uploads/${uploadId}${extension}`;

	await uploadTempObject({
		key,
		body: new Uint8Array(fileBuffer),
		contentType: file.type || "video/mp4",
	});

	const sourceUrl = await createSignedDownloadUrl({
		key,
		expiresInSeconds: RUNPOD_SIGNED_URL_EXPIRY_SECONDS,
	});

	return { key, sourceUrl };
}

async function createRunpodR2ResultUpload({ file }: { file: File }) {
	const extension = path.extname(file.name) || ".mp4";
	const uploadId = randomUUID();
	const key = `temp-results/${uploadId}${extension}`;
	const contentType = file.type || "video/mp4";

	const [resultUploadUrl, resultDownloadUrl] = await Promise.all([
		createSignedUploadUrl({
			key,
			contentType,
			expiresInSeconds: RUNPOD_SIGNED_URL_EXPIRY_SECONDS,
		}),
		createSignedDownloadUrl({
			key,
			expiresInSeconds: RUNPOD_SIGNED_URL_EXPIRY_SECONDS,
		}),
	]);

	return { key, resultUploadUrl, resultDownloadUrl };
}

async function waitForRunpodCompletion({
	jobId,
	onStatus,
}: {
	jobId: string;
	onStatus?: (status: string) => void;
}) {
	const timeoutAt = Date.now() + 1000 * 60 * 20;

	while (Date.now() < timeoutAt) {
		const status = await getRunpodJobStatus({ jobId });
		onStatus?.(status.status);

		if (typeof status.error === "string" && status.error) {
			throw new Error(`Runpod worker failed: ${status.error}`);
		}

		if (status.status === "COMPLETED" || status.status === "SUCCESS") {
			return status;
		}

		if (
			status.status === "FAILED" ||
			status.status === "CANCELLED" ||
			status.status === "TIMED_OUT"
		) {
			throw new Error(
				`Runpod job failed. Status: ${status.status}${
					status.error ? ` - ${status.error}` : ""
				}`,
			);
		}

		await sleep(2500);
	}

	throw new Error("Runpod job timed out while waiting for completion.");
}

async function runRunpodWatermark({
	file,
	fileBuffer,
	sourceUrl,
	resultUploadUrl,
	resultDownloadUrl,
	detectionPrompt,
	detectionSkip,
	fadeIn,
	fadeOut,
	jobId,
	transparent,
	regions,
}: {
	file: File;
	fileBuffer: Buffer;
	sourceUrl?: string;
	resultUploadUrl?: string;
	resultDownloadUrl?: string;
	detectionPrompt: string;
	detectionSkip: number;
	fadeIn: string;
	fadeOut: string;
	jobId: string;
	transparent: boolean;
	regions?: Array<{
		x: number;
		y: number;
		width: number;
		height: number;
	}> | null;
}) {
	let queuedJob: Awaited<ReturnType<typeof submitRunpodJob>>;
	try {
		queuedJob = await submitRunpodJob({
			input: {
				task: "watermark_remove",
				engine: "watermarkremover-ai",
				filename: file.name,
				mimeType: file.type || "video/mp4",
				...(sourceUrl
					? { sourceUrl }
					: { fileBase64: fileBuffer.toString("base64") }),
				...(resultUploadUrl ? { resultUploadUrl } : {}),
				detectionPrompt,
				detectionSkip,
				fadeIn,
				fadeOut,
				transparent,
				...(regions && regions.length > 0 ? { regions } : {}),
			},
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("exceeded max body size of 10MiB")
		) {
			throw new Error("RUNPOD_BODY_LIMIT_EXCEEDED");
		}
		throw error;
	}

	if (typeof queuedJob.error === "string" && queuedJob.error) {
		throw new Error(`Runpod worker failed: ${queuedJob.error}`);
	}

	if (!queuedJob.id) {
		throw new Error("Runpod did not return a job id.");
	}

	updateWatermarkProgress(jobId, {
		phase: "queued",
		progress: 30,
		message: "Queued on Runpod",
		detail: "Waiting for an available worker to pick up the AI job.",
	});

	const result = await waitForRunpodCompletion({
		jobId: queuedJob.id,
		onStatus: (status) => {
			if (status === "IN_PROGRESS") {
				updateWatermarkProgress(jobId, {
					phase: "processing",
					progress: 62,
					message: "Processing on remote GPU",
					detail: "Runpod is detecting and removing the watermark on the GPU.",
				});
				return;
			}

			if (status === "IN_QUEUE" || status === "QUEUED") {
				updateWatermarkProgress(jobId, {
					phase: "queued",
					progress: 34,
					message: "Queued on Runpod",
					detail: "Waiting for an available worker to pick up the AI job.",
				});
			}
		},
	});

	if (resultDownloadUrl) {
		try {
			return await downloadBufferWithRetry(resultDownloadUrl);
		} catch (error) {
			throw new Error(
				`Runpod completed but the result download failed: ${
					error instanceof Error ? error.message : "unknown error"
				}`,
			);
		}
	}

	const parsed = parseRunpodVideoOutput(result.output ?? result);
	if (!parsed) {
		throw new Error(
			`Runpod returned no usable video output. Status: ${
				result.status ?? "unknown"
			}. Expected videoBase64 or videoUrl in the result.`,
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
	const requestJobId =
		request.headers.get("x-gsm-watermark-job-id") ??
		request.headers.get("x-gsm-job-id");
	const file = formData.get("file");
	const engine = parseEngine(formData.get("engine"));
	const x = parsePositiveInt(formData.get("x"));
	const y = parsePositiveInt(formData.get("y"));
	const width = parsePositiveInt(formData.get("width"));
	const height = parsePositiveInt(formData.get("height"));
	const regions =
		parseFastRegions(formData.get("regions")) ??
		([x, y, width, height].every((value) => value !== null) && width && height
			? [{ x: x as number, y: y as number, width, height }]
			: null);
	const detectionPrompt =
		typeof formData.get("detectionPrompt") === "string"
			? (formData.get("detectionPrompt") as string)
			: "watermark";
	const detectionSkip = parsePositiveInt(formData.get("detectionSkip")) ?? 2;
	const transparent =
		typeof formData.get("transparent") === "string"
			? formData.get("transparent") === "true"
			: false;
	const preview =
		typeof formData.get("preview") === "string"
			? formData.get("preview") === "true"
			: false;
	const fadeIn =
		typeof formData.get("fadeIn") === "string" ? formData.get("fadeIn") : "0.2";
	const fadeOut =
		typeof formData.get("fadeOut") === "string"
			? formData.get("fadeOut")
			: "0.2";

	if (!(file instanceof File)) {
		return new NextResponse("No file uploaded", { status: 400 });
	}

	if (engine === "fast" && (!regions || regions.length === 0)) {
		return new NextResponse("Invalid watermark region", { status: 400 });
	}

	const jobId = requestJobId?.trim() || randomUUID();
	const tempDir = path.join(os.tmpdir(), "gsmediacut-watermark", jobId);
	await fs.mkdir(tempDir, { recursive: true });
	initWatermarkProgress(jobId);

	const inputExtension = path.extname(file.name) || ".mp4";
	const inputPath = path.join(tempDir, `input${inputExtension}`);
	const outputPath = path.join(tempDir, "output_cleaned.mp4");
	let responseEngine = engine;
	let aiMode = "n/a";
	let aiModeReason: string | null = null;
	let runpodR2Upload: { key: string; sourceUrl: string } | null = null;
	let runpodR2ResultUpload: {
		key: string;
		resultUploadUrl: string;
		resultDownloadUrl: string;
	} | null = null;
	let runpodSourceUpload: {
		filePath: string;
		metadataPath: string;
		sourceUrl: string;
	} | null = null;

	try {
		const inputBuffer = Buffer.from(await file.arrayBuffer());
		await fs.writeFile(inputPath, inputBuffer);
		const inputVideoSize = await getVideoDimensions(inputPath);
		const normalizedRegions = clampRegionsToVideo(regions, inputVideoSize);
		const delogoSafeRegions = makeDelogoSafeRegions(
			normalizedRegions,
			inputVideoSize,
		);
		if (
			engine === "fast" &&
			(!delogoSafeRegions || delogoSafeRegions.length === 0)
		) {
			throw new Error("Selected watermark area is outside the video frame.");
		}
		const previewCacheKey = preview
			? createHash("sha1")
					.update(inputBuffer)
					.update("\0")
					.update(detectionPrompt.trim().toLowerCase())
					.update("\0")
					.update(JSON.stringify(normalizedRegions ?? []))
					.digest("hex")
			: null;
		updateWatermarkProgress(jobId, {
			phase: "preparing",
			progress: 6,
			message: "Preparing clip",
			detail: "Checking the selected clip and building the processing request.",
		});

		if (preview) {
			const previewCache = getPreviewCache();
			const cachedPreview = previewCacheKey
				? previewCache.get(previewCacheKey)
				: null;
			if (cachedPreview && cachedPreview.expiresAt > Date.now()) {
				completeWatermarkProgress(jobId, {
					phase: "completed",
					progress: 100,
					message: "Preview detection ready",
					detail: "Loaded the cached detection preview.",
				});
				return NextResponse.json(cachedPreview.result);
			}

			const scriptPath = await resolveVendorFile(
				"WatermarkRemover-AI",
				"remwm.py",
			);
			const vendorRoot = await resolveVendorFile("WatermarkRemover-AI");
			if (!scriptPath) {
				return NextResponse.json(
					{ error: "WatermarkRemover-AI script not found in vendor" },
					{ status: 500 },
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

			const previewResult = await runCommandCapture({
				command: "python",
				cwd: vendorRoot ?? path.dirname(scriptPath),
				env: pythonEnv,
				timeoutMs: PREVIEW_TIMEOUT_MS,
				args: [
					scriptPath,
					inputPath,
					outputPath,
					"--preview",
					...(normalizedRegions && normalizedRegions.length > 0
						? ["--manual-regions-json", JSON.stringify(normalizedRegions)]
						: []),
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

			const lines = previewResult.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			const jsonLine = [...lines]
				.reverse()
				.find((line) => line.startsWith("{") && line.endsWith("}"));

			if (!jsonLine) {
				throw new Error("Preview detection did not return JSON output.");
			}

			const previewPayload = JSON.parse(jsonLine);
			if (previewCacheKey) {
				previewCache.set(previewCacheKey, {
					expiresAt: Date.now() + 1000 * 60 * 10,
					result: previewPayload,
				});
			}

			completeWatermarkProgress(jobId, {
				phase: "completed",
				progress: 100,
				message: "Preview detection completed",
				detail: "Detection preview is ready.",
			});
			return NextResponse.json(previewPayload);
		}

		if (engine === "ai") {
			const shouldUseRunpod =
				hasRunpodConfig() &&
				(hasR2Config() ||
					inputBuffer.byteLength <= RUNPOD_SAFE_RAW_UPLOAD_BYTES ||
					Boolean(getPublicBaseUrl()));

			if (hasRunpodConfig() && !shouldUseRunpod) {
				aiMode = "local-fallback";
				aiModeReason =
					"Clip is too large for Runpod inline upload and neither R2 nor a public upload URL is configured, so AI fell back to local processing.";
			}

			if (shouldUseRunpod) {
				try {
					updateWatermarkProgress(jobId, {
						phase: "uploading",
						progress: 18,
						message: hasR2Config()
							? "Uploading to R2"
							: inputBuffer.byteLength > RUNPOD_SAFE_RAW_UPLOAD_BYTES
								? "Uploading to server"
								: "Sending clip to Runpod",
						detail: hasR2Config()
							? "Sending the source clip to Cloudflare R2 so Runpod can download it."
							: inputBuffer.byteLength > RUNPOD_SAFE_RAW_UPLOAD_BYTES
								? "Sending the source clip to your server so Runpod can download it."
								: "Sending the clip directly to Runpod in the request body.",
					});

					if (hasR2Config()) {
						[runpodR2Upload, runpodR2ResultUpload] = await Promise.all([
							createRunpodR2Upload({
								file,
								fileBuffer: inputBuffer,
							}),
							createRunpodR2ResultUpload({ file }),
						]);
					} else if (inputBuffer.byteLength > RUNPOD_SAFE_RAW_UPLOAD_BYTES) {
						runpodSourceUpload = await createRunpodSourceUpload({
							file,
							fileBuffer: inputBuffer,
						});
						if (!runpodSourceUpload) {
							aiMode = "local-fallback";
							aiModeReason =
								"Large Runpod jobs need R2 configured or SERVER_PUBLIC_BASE_URL set to a public URL so Runpod can download the clip.";
						}
					}

					if (aiMode !== "local-fallback") {
						const runpodBuffer = await runRunpodWatermark({
							file,
							fileBuffer: inputBuffer,
							sourceUrl:
								runpodR2Upload?.sourceUrl ?? runpodSourceUpload?.sourceUrl,
							resultUploadUrl: runpodR2ResultUpload?.resultUploadUrl,
							resultDownloadUrl: runpodR2ResultUpload?.resultDownloadUrl,
							detectionPrompt,
							detectionSkip: Math.min(Math.max(detectionSkip, 1), 10),
							fadeIn,
							fadeOut,
							jobId,
							transparent,
							regions: normalizedRegions,
						});
						aiMode = runpodR2Upload
							? "runpod-r2"
							: runpodSourceUpload
								? "runpod-url"
								: "runpod";
						updateWatermarkProgress(jobId, {
							phase: "downloading",
							progress: 82,
							message: "Downloading cleaned result",
							detail: "Fetching the cleaned video back into GSMEDIACUT.",
						});
						await fs.writeFile(outputPath, runpodBuffer);
					}
				} catch (error) {
					if (shouldFallbackToLocalAi(error)) {
						aiMode = "local-fallback";
						aiModeReason = getLocalAiFallbackReason(error);
					} else {
						throw error;
					}
				}
			}

			if (!isRemoteAiMode(aiMode)) {
				const scriptPath = await resolveVendorFile(
					"WatermarkRemover-AI",
					"remwm.py",
				);
				const vendorRoot = await resolveVendorFile("WatermarkRemover-AI");
				if (!scriptPath) {
					failWatermarkProgress(
						jobId,
						"WatermarkRemover-AI script not found",
						"WatermarkRemover-AI script not found in vendor",
					);
					return new NextResponse(
						"WatermarkRemover-AI script not found in vendor",
						{
							status: 500,
						},
					);
				}
				responseEngine = "ai";
				if (aiMode === "n/a") {
					aiMode = "local";
					aiModeReason =
						"Runpod is not configured, so AI used local processing.";
				}
				updateWatermarkProgress(jobId, {
					phase: "processing",
					progress: 12,
					message: "Processing locally",
					detail: "WatermarkRemover-AI is running on the local worker.",
				});

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
					onStdoutLine: (line) => {
						const parsed = parseOverallProgressFromLine(line);
						if (parsed === null) {
							return;
						}
						updateWatermarkProgress(jobId, {
							phase: "processing",
							progress: Math.max(12, Math.min(96, parsed)),
							message: "Processing locally",
							detail: `WatermarkRemover-AI progress: ${parsed}%`,
						});
					},
					onStderrLine: (line) => {
						const parsed = parseOverallProgressFromLine(line);
						if (parsed === null) {
							return;
						}
						updateWatermarkProgress(jobId, {
							phase: "processing",
							progress: Math.max(12, Math.min(96, parsed)),
							message: "Processing locally",
							detail: `WatermarkRemover-AI progress: ${parsed}%`,
						});
					},
					args: [
						scriptPath,
						inputPath,
						outputPath,
						"--overwrite",
						...(transparent ? ["--transparent"] : []),
						...(normalizedRegions && normalizedRegions.length > 0
							? ["--manual-regions-json", JSON.stringify(normalizedRegions)]
							: []),
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
		} else {
			const delogoRegions = delogoSafeRegions ?? [];
			updateWatermarkProgress(jobId, {
				phase: "processing",
				progress: 25,
				message: "Processing locally",
				detail:
					delogoRegions.length > 1
						? `Applying FFmpeg delogo to ${delogoRegions.length} selected regions.`
						: "Applying FFmpeg delogo to the selected region.",
			});
			await runFfmpeg([
				"-y",
				"-i",
				inputPath,
				"-vf",
				delogoRegions
					.map(
						(region) =>
							`delogo=x=${region.x}:y=${region.y}:w=${region.width}:h=${region.height}:show=0`,
					)
					.join(","),
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

		updateWatermarkProgress(jobId, {
			phase: "cleaning",
			progress: 97,
			message: "Cleaning up temporary files",
			detail: "Finalizing the cleaned clip response.",
		});

		const outputBuffer = await fs.readFile(outputPath);
		completeWatermarkProgress(jobId, {
			phase: "completed",
			progress: 100,
			message: "Watermark cleanup completed",
			detail: "The cleaned clip is ready to import into the timeline.",
		});
		return new NextResponse(new Uint8Array(outputBuffer), {
			status: 200,
			headers: {
				"Content-Type": "video/mp4",
				"X-GSM-Engine": responseEngine,
				"X-GSM-AI-Mode": aiMode,
				"X-GSM-AI-Reason": aiModeReason ?? "",
				"Content-Disposition": `inline; filename="${path.basename(file.name, inputExtension)}_cleaned.mp4"`,
			},
		});
	} catch (error) {
		console.error("Watermark processing failed:", error);
		failWatermarkProgress(
			jobId,
			"Watermark cleanup failed",
			error instanceof Error ? error.message : "Unknown error",
		);
		return new NextResponse(
			error instanceof Error ? error.message : "Watermark processing failed",
			{ status: 500 },
		);
	} finally {
		if (runpodR2Upload) {
			await deleteR2Object({ key: runpodR2Upload.key }).catch(() => undefined);
		}
		if (runpodR2ResultUpload) {
			await deleteR2Object({ key: runpodR2ResultUpload.key }).catch(
				() => undefined,
			);
		}
		await cleanupRunpodSourceUpload(runpodSourceUpload);
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}
