import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_RENDER_TIMEOUT_MS = 1000 * 60 * 15;
const TTS_FETCH_TIMEOUT_MS = 15000;
const OUTPUT_SAMPLE_RATE = 44100;

const TOOL_BUILD_ROOT_CANDIDATES = [
	path.resolve(
		process.cwd(),
		"..",
		"..",
		"..",
		"TOOL-BUILD-OWN-API",
		"TOOL BUILD OWN API",
	),
	path.resolve(
		process.cwd(),
		"..",
		"..",
		"TOOL-BUILD-OWN-API",
		"TOOL BUILD OWN API",
	),
];

type RenderRow = {
	id: string;
	startSeconds: number;
	endSeconds: number;
	text: string;
	voiceModel?: string;
	speedPercent?: number;
	pitchSemitones?: number;
	echoPercent?: number;
	volumeDb?: number;
};

type OutputFormat = "wav" | "mp3";
type ActingEngine = "TTS" | "Kokoro" | "StyleTTS2";

type PythonCandidate = {
	command: string;
	argsPrefix: string[];
};

function sanitizeFilenamePart(value: string) {
	return (
		value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "voice"
	);
}

function inferMimeType(filePath: string) {
	return path.extname(filePath).toLowerCase() === ".wav"
		? "audio/wav"
		: "audio/mpeg";
}

function inferOutputFormat(value: unknown): OutputFormat {
	return String(value).trim().toLowerCase() === "mp3" ? "mp3" : "wav";
}

function inferActingEngine(value: unknown): ActingEngine {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	if (normalized === "kokoro") {
		return "Kokoro";
	}
	if (
		normalized === "styletts2" ||
		normalized === "style-tts2" ||
		normalized === "style tts2"
	) {
		return "StyleTTS2";
	}
	return "TTS";
}

function getFfmpegBinary() {
	return process.env.FFMPEG_BINARY || "ffmpeg";
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function inferRowLanguage(text: string) {
	if (/[\u1780-\u17ff]/.test(text)) {
		return "km";
	}
	if (/[\u0e00-\u0e7f]/.test(text)) {
		return "th";
	}
	if (/[\u4e00-\u9fff]/.test(text)) {
		return "zh-CN";
	}
	return "en";
}

function buildAtempoFilters(playbackRate: number) {
	const safeRate = clamp(playbackRate, 0.25, 4);
	const filters: string[] = [];
	let remaining = safeRate;

	while (remaining > 2) {
		filters.push("atempo=2");
		remaining /= 2;
	}
	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}

	filters.push(`atempo=${remaining.toFixed(4)}`);
	return filters;
}

function buildAudioFilter(row: RenderRow) {
	const filters: string[] = [];
	const playbackRate = clamp((row.speedPercent ?? 100) / 100, 0.25, 4);

	filters.push(...buildAtempoFilters(playbackRate));

	if (row.pitchSemitones) {
		const pitchMultiplier = 2 ** (row.pitchSemitones / 12);
		filters.push(
			`asetrate=${Math.round(OUTPUT_SAMPLE_RATE * pitchMultiplier)}`,
			`aresample=${OUTPUT_SAMPLE_RATE}`,
		);
	}

	if (row.echoPercent && row.echoPercent > 0) {
		const decay = clamp(row.echoPercent / 100, 0.05, 0.65);
		filters.push(`aecho=0.8:0.88:120:${decay.toFixed(2)}`);
	}

	if (row.volumeDb && row.volumeDb !== 0) {
		filters.push(`volume=${row.volumeDb}dB`);
	}

	return filters.join(",");
}

async function createSilenceFile({
	workDir,
	filename,
	durationSeconds,
}: {
	workDir: string;
	filename: string;
	durationSeconds: number;
}) {
	await runCommand({
		command: getFfmpegBinary(),
		args: [
			"-y",
			"-f",
			"lavfi",
			"-i",
			`anullsrc=r=${OUTPUT_SAMPLE_RATE}:cl=mono`,
			"-t",
			durationSeconds.toFixed(3),
			filename,
		],
		cwd: workDir,
		timeoutMs: VOICE_RENDER_TIMEOUT_MS,
	});
}

async function downloadTtsMp3({
	text,
	language,
}: {
	text: string;
	language: string;
}) {
	const url = new URL("https://translate.googleapis.com/translate_tts");
	url.searchParams.set("ie", "UTF-8");
	url.searchParams.set("client", "tw-ob");
	url.searchParams.set("tl", language);
	url.searchParams.set("q", text);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: {
				Accept: "audio/mpeg,*/*",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
			},
			cache: "no-store",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`TTS request failed with ${response.status}`);
		}

		return Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timeout);
	}
}

async function buildFallbackVoiceTrack({
	workDir,
	rows,
}: {
	workDir: string;
	rows: RenderRow[];
}) {
	const concatParts: string[] = [];
	let timelineCursorSeconds = 0;

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		const text = row.text.trim();
		if (!text) {
			continue;
		}

		const startSeconds = Math.max(0, row.startSeconds);
		const endSeconds = Math.max(startSeconds, row.endSeconds);
		const segmentDurationSeconds = Math.max(0.15, endSeconds - startSeconds);
		const gapSeconds = Math.max(0, startSeconds - timelineCursorSeconds);

		if (gapSeconds > 0.02) {
			const silenceFilename = `part-${String(index).padStart(4, "0")}-silence.wav`;
			await createSilenceFile({
				workDir,
				filename: silenceFilename,
				durationSeconds: gapSeconds,
			});
			concatParts.push(`file '${silenceFilename}'`);
		}

		const inputFilename = `part-${String(index).padStart(4, "0")}.mp3`;
		const outputFilename = `part-${String(index).padStart(4, "0")}.wav`;
		await fs.writeFile(
			path.join(workDir, inputFilename),
			await downloadTtsMp3({
				text,
				language: inferRowLanguage(text),
			}),
		);

		const audioFilter = buildAudioFilter(row);
		const args = [
			"-y",
			"-i",
			inputFilename,
			"-ar",
			String(OUTPUT_SAMPLE_RATE),
			"-ac",
			"1",
		];

		args.push(
			"-af",
			audioFilter
				? `${audioFilter},apad=pad_dur=${segmentDurationSeconds.toFixed(3)},atrim=0:${segmentDurationSeconds.toFixed(3)}`
				: `apad=pad_dur=${segmentDurationSeconds.toFixed(3)},atrim=0:${segmentDurationSeconds.toFixed(3)}`,
			outputFilename,
		);

		await runCommand({
			command: getFfmpegBinary(),
			args,
			cwd: workDir,
			timeoutMs: VOICE_RENDER_TIMEOUT_MS,
		});

		concatParts.push(`file '${outputFilename}'`);
		timelineCursorSeconds = endSeconds;
	}

	if (concatParts.length === 0) {
		throw new Error(
			"No subtitle rows with text were available for audio export.",
		);
	}

	const concatFilename = "concat-list.txt";
	await fs.writeFile(
		path.join(workDir, concatFilename),
		concatParts.join("\n"),
		"utf8",
	);

	const outputFilename = "timeline-voice-track.wav";
	await runCommand({
		command: getFfmpegBinary(),
		args: [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			concatFilename,
			"-c",
			"copy",
			outputFilename,
		],
		cwd: workDir,
		timeoutMs: VOICE_RENDER_TIMEOUT_MS,
	});

	return path.join(workDir, outputFilename);
}

async function convertOutputFormat({
	workDir,
	inputPath,
	outputFormat,
}: {
	workDir: string;
	inputPath: string;
	outputFormat: OutputFormat;
}) {
	const currentExtension = path.extname(inputPath).toLowerCase();
	if (
		(outputFormat === "wav" && currentExtension === ".wav") ||
		(outputFormat === "mp3" && currentExtension === ".mp3")
	) {
		return inputPath;
	}

	const outputFilename =
		outputFormat === "mp3"
			? "timeline-voice-track.mp3"
			: "timeline-voice-track.wav";
	const outputPath = path.join(workDir, outputFilename);
	const args = ["-y", "-i", inputPath];

	if (outputFormat === "mp3") {
		args.push("-codec:a", "libmp3lame", "-q:a", "2", outputPath);
	} else {
		args.push("-ar", String(OUTPUT_SAMPLE_RATE), "-ac", "1", outputPath);
	}

	await runCommand({
		command: getFfmpegBinary(),
		args,
		cwd: workDir,
		timeoutMs: VOICE_RENDER_TIMEOUT_MS,
	});

	return outputPath;
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
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env,
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

function getHelperScriptPath() {
	return path.resolve(process.cwd(), "scripts", "rvc_timeline_render.py");
}

function uniqueStrings(values: Array<string | null | undefined>) {
	return [
		...new Set(values.filter((value): value is string => Boolean(value))),
	];
}

function getPythonCandidates(): PythonCandidate[] {
	const localAppRoots = uniqueStrings([
		process.env.LOCALAPPDATA,
		process.env.USERPROFILE
			? path.join(process.env.USERPROFILE, "AppData", "Local")
			: null,
		path.join(os.homedir(), "AppData", "Local"),
	]);

	const absoluteCandidates = localAppRoots.flatMap((root) => [
		path.join(root, "Programs", "Python", "Python310", "python.exe"),
		path.join(root, "Programs", "Python", "Python311", "python.exe"),
	]);

	return [
		...absoluteCandidates.map((command) => ({
			command,
			argsPrefix: [],
		})),
		...(process.env.PYTHON_BINARY
			? [
					{
						command: process.env.PYTHON_BINARY,
						argsPrefix: [],
					},
				]
			: []),
		{
			command: "py",
			argsPrefix: ["-3.10"],
		},
		{
			command: "py",
			argsPrefix: ["-3.11"],
		},
	];
}

async function resolveToolBuildRoot() {
	for (const candidate of TOOL_BUILD_ROOT_CANDIDATES) {
		try {
			const stats = await fs.stat(candidate);
			if (stats.isDirectory()) {
				return candidate;
			}
		} catch {}
	}

	return null;
}

async function resolvePythonBinary() {
	for (const candidate of getPythonCandidates()) {
		const isAbsolute = path.isAbsolute(candidate.command);
		if (isAbsolute) {
			try {
				await fs.access(candidate.command);
			} catch {
				continue;
			}
		}

		try {
			const { stdout, stderr } = await runCommand({
				command: candidate.command,
				args: [...candidate.argsPrefix, "--version"],
				cwd: process.cwd(),
				timeoutMs: 8000,
			});
			const versionOutput = `${stdout} ${stderr}`.trim();
			const match = versionOutput.match(/Python\s+(\d+)\.(\d+)/i);
			if (!match) {
				continue;
			}
			const major = Number(match[1]);
			const minor = Number(match[2]);
			if (major !== 3 || (minor !== 10 && minor !== 11)) {
				continue;
			}
			return candidate;
		} catch {}
	}

	return null;
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as {
			rows?: RenderRow[];
			sourceLabel?: string;
			outputFormat?: OutputFormat;
			actingEngine?: string;
		};
		const rows = Array.isArray(body.rows) ? body.rows : [];
		const outputFormat = inferOutputFormat(body.outputFormat);
		const actingEngine = inferActingEngine(body.actingEngine);

		if (rows.length === 0) {
			return new NextResponse("No transcript rows provided.", { status: 400 });
		}

		const toolBuildRoot = await resolveToolBuildRoot();
		if (!toolBuildRoot) {
			return new NextResponse("TOOL BUILD OWN API folder was not found.", {
				status: 500,
			});
		}

		const pythonBinary = await resolvePythonBinary();
		if (!pythonBinary) {
			return new NextResponse("Python 3.10 or 3.11 was not found.", {
				status: 500,
			});
		}

		const helperScriptPath = getHelperScriptPath();
		try {
			await fs.access(helperScriptPath);
		} catch {
			return new NextResponse("RVC timeline helper script was not found.", {
				status: 500,
			});
		}

		const workDir = path.join(
			os.tmpdir(),
			"gsmediacut-transition-voice",
			randomUUID(),
		);
		await fs.mkdir(workDir, { recursive: true });

		try {
			const inputJsonPath = path.join(workDir, "input.json");
			const outputJsonPath = path.join(workDir, "output.json");
			await fs.writeFile(
				inputJsonPath,
				JSON.stringify({
					rows,
					actingEngine,
				}),
				"utf8",
			);

			let outputPath: string;
			let outputRows = rows;
			let renderMode: "rvc" | "fallback" = "rvc";

			try {
				await runCommand({
					command: pythonBinary.command,
					args: [
						...pythonBinary.argsPrefix,
						"-s",
						"-X",
						"utf8",
						helperScriptPath,
						"--tool-root",
						toolBuildRoot,
						"--input-json",
						inputJsonPath,
						"--output-json",
						outputJsonPath,
					],
					cwd: process.cwd(),
					timeoutMs: VOICE_RENDER_TIMEOUT_MS,
					env: {
						...process.env,
						PYTHONNOUSERSITE: "1",
					},
				});

				const outputPayload = JSON.parse(
					await fs.readFile(outputJsonPath, "utf8"),
				) as {
					outputPath?: string;
					rows?: RenderRow[];
				};
				if (!outputPayload.outputPath) {
					throw new Error("RVC helper did not return an output file.");
				}
				outputPath = outputPayload.outputPath;
				outputRows = outputPayload.rows ?? rows;
			} catch (helperError) {
				console.warn(
					"RVC helper failed, falling back to direct TTS timeline render:",
					helperError,
				);
				renderMode = "fallback";
				outputPath = await buildFallbackVoiceTrack({
					workDir,
					rows,
				});
			}

			const finalOutputPath = await convertOutputFormat({
				workDir,
				inputPath: outputPath,
				outputFormat,
			});
			const outputBuffer = await fs.readFile(finalOutputPath);
			const sourceLabel = sanitizeFilenamePart(
				body.sourceLabel ?? "transition",
			);

			return NextResponse.json({
				filename: `${sourceLabel}_voice_track.${outputFormat}`,
				mimeType: inferMimeType(finalOutputPath),
				base64: outputBuffer.toString("base64"),
				rows: outputRows,
				renderMode,
			});
		} finally {
			await fs.rm(workDir, { recursive: true, force: true });
		}
	} catch (error) {
		console.error("Timeline voice render failed:", error);
		return new NextResponse(
			error instanceof Error ? error.message : "Timeline voice render failed.",
			{ status: 500 },
		);
	}
}
