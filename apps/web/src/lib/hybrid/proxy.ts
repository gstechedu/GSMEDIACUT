import { generateUUID } from "@/utils/id";

export const DEFAULT_PROXY_HEIGHT = 480;

export interface ProxyGenerationPlan {
	proxyId: string;
	outputFileName: string;
	outputRelativePath: string;
	command: string[];
}

export function buildFastPreviewProxyCommand({
	inputPath,
	outputPath,
	ffmpegBinary = "ffmpeg",
	height = DEFAULT_PROXY_HEIGHT,
}: {
	inputPath: string;
	outputPath: string;
	ffmpegBinary?: string;
	height?: number;
}): string[] {
	return [
		ffmpegBinary,
		"-y",
		"-i",
		inputPath,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-vf",
		`scale=-2:${height}`,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"32",
		"-g",
		"24",
		"-keyint_min",
		"24",
		"-sc_threshold",
		"0",
		"-c:a",
		"aac",
		"-b:a",
		"96k",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

export function createProxyGenerationPlan({
	inputPath,
	originalFileName,
	tempRoot = "temp/proxies",
	height = DEFAULT_PROXY_HEIGHT,
	ffmpegBinary = "ffmpeg",
}: {
	inputPath: string;
	originalFileName: string;
	tempRoot?: string;
	height?: number;
	ffmpegBinary?: string;
}): ProxyGenerationPlan {
	const proxyId = generateUUID();
	const sanitizedStem = sanitizeFileStem(originalFileName);
	const outputFileName = `${sanitizedStem || "clip"}_${proxyId}_proxy.mp4`;
	const outputRelativePath = [trimSlashes(tempRoot), outputFileName]
		.filter(Boolean)
		.join("/");

	return {
		proxyId,
		outputFileName,
		outputRelativePath,
		command: buildFastPreviewProxyCommand({
			inputPath,
			outputPath: outputRelativePath,
			ffmpegBinary,
			height,
		}),
	};
}

function sanitizeFileStem(fileName: string): string {
	const stem = fileName.replace(/\.[^/.]+$/, "");
	return stem
		.normalize("NFKD")
		.replace(/[^\w.-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 48);
}

function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, "");
}
