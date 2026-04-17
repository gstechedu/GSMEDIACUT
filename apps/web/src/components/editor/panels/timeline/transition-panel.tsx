"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/lib/commands";
import {
	normalizeTransitionActingEngine,
	useTimelineStore,
	type TransitionTranscriptRow,
} from "@/stores/timeline-store";
import { generateUUID } from "@/utils/id";
import { useSyncTransitionCaptions } from "./transition-caption-sync";
import { useVoiceModelOptions } from "@/hooks/use-voice-model-options";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";

const STYLE_OPTIONS = ["Adult", "Child", "Teen"] as const;
const EMOTION_OPTIONS = ["natural", "crying", "angry", "happy"] as const;
const AUTO_SPEED_MIN_PERCENT = 90;
const AUTO_SPEED_MAX_PERCENT = 135;
const AUTO_ECHO_PERCENT = 0;
const BUILD_AUDIO_TASK_KEY = "transition:build-audio";

function formatTimestamp(totalSeconds: number) {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const milliseconds = Math.round(
		(totalSeconds - Math.floor(totalSeconds)) * 1000,
	);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function getRowText(row: TransitionTranscriptRow) {
	return row.text.trim() || row.originalText.trim();
}

function countSpeechCharacters(text: string) {
	return Array.from(text).filter((character) => !/\s/u.test(character)).length;
}

function countSpeechPauses(text: string) {
	const matches = text.match(/[.,!?;:។៕၊，。！？]/gu);
	return matches?.length ?? 0;
}

function estimateComfortableSpeechSeconds(row: TransitionTranscriptRow) {
	const text = getRowText(row);
	if (!text) {
		return Math.max(0.15, row.endSeconds - row.startSeconds);
	}

	const characterCount = countSpeechCharacters(text);
	const pauseCount = countSpeechPauses(text);
	return 0.45 + characterCount / 10 + pauseCount * 0.18;
}

function recommendRowSpeedPercent(row: TransitionTranscriptRow) {
	const targetDurationSeconds = Math.max(
		0.15,
		row.endSeconds - row.startSeconds,
	);
	const comfortableDurationSeconds = estimateComfortableSpeechSeconds(row);
	return Math.round(
		clamp(
			(comfortableDurationSeconds / targetDurationSeconds) * 100,
			AUTO_SPEED_MIN_PERCENT,
			AUTO_SPEED_MAX_PERCENT,
		),
	);
}

function buildSrtContent(rows: TransitionTranscriptRow[]) {
	return rows
		.map((row, index) =>
			[
				String(index + 1),
				`${formatTimestamp(row.startSeconds)} --> ${formatTimestamp(row.endSeconds)}`,
				row.text.trim() || row.originalText.trim(),
			].join("\n"),
		)
		.join("\n\n");
}

function downloadSrt(
	rows: TransitionTranscriptRow[],
	sourceLabel: string | null,
) {
	const srtContent = buildSrtContent(rows);
	const blob = new Blob([srtContent], {
		type: "application/x-subrip;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${sanitizeFilePart(sourceLabel ?? "transition")}.srt`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

function sanitizeFilePart(value: string) {
	const sanitized = Array.from(value)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint >= 0x20 && !/[<>:"/\\|?*]/u.test(character);
		})
		.join("");

	return (
		sanitized
			.replace(/[-]+/g, "-")
			.replace(/\s+/g, "_")
			.replace(/_+/g, "_")
			.replace(/^[-_.]+|[-_.]+$/g, "") || "transition"
	);
}

function decodeBase64File(base64: string, mimeType: string) {
	return new Blob(
		[Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))],
		{
			type: mimeType,
		},
	);
}

type RenderedAudioPayload = {
	filename: string;
	mimeType: string;
	base64: string;
	rows?: TransitionTranscriptRow[];
	renderMode?: "rvc" | "fallback";
};

function TableSelect({
	value,
	options,
	onChange,
	variant = "cyan",
}: {
	value: string;
	options: readonly string[];
	onChange: (value: string) => void;
	variant?: "cyan" | "green";
}) {
	const visibleOptions =
		value && !options.includes(value) ? [value, ...options] : options;

	return (
		<select
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className={[
				"h-9 w-full rounded-sm border bg-[#173964] px-2 text-sm outline-hidden",
				variant === "green"
					? "border-[#22ff22] text-[#22ff22]"
					: "border-[#20d9ff] text-[#20d9ff]",
			].join(" ")}
		>
			{visibleOptions.map((option) => (
				<option key={option} value={option} className="bg-[#173964] text-white">
					{option}
				</option>
			))}
		</select>
	);
}

function NumberInput({
	value,
	onChange,
}: {
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<input
			type="number"
			value={value}
			onChange={(event) => onChange(Number(event.target.value) || 0)}
			className="h-9 w-full rounded-sm border border-[#264d78] bg-[#12171f] px-2 text-sm text-white outline-hidden"
		/>
	);
}

function TransitionRow({
	index,
	row,
	isSpeaking,
	isDownloading,
	voiceModelOptions,
	onPreview,
	onDownload,
	onUpdate,
	onRemove,
}: {
	index: number;
	row: TransitionTranscriptRow;
	isSpeaking: boolean;
	isDownloading: boolean;
	voiceModelOptions: readonly string[];
	onPreview: (row: TransitionTranscriptRow) => void;
	onDownload: (row: TransitionTranscriptRow) => void;
	onUpdate: (patch: Partial<TransitionTranscriptRow>) => void;
	onRemove: () => void;
}) {
	return (
		<tr className="border-t border-[#0f345a] bg-[#141a22]">
			<td className="border-r border-[#0f345a] px-3 py-3 text-center font-semibold text-[#19d7ff]">
				{index + 1}
			</td>
			<td className="border-r border-[#0f345a] px-2 py-3 text-sm text-white">
				{formatTimestamp(row.startSeconds)}
			</td>
			<td className="border-r border-[#0f345a] px-2 py-3 text-sm text-white">
				{formatTimestamp(row.endSeconds)}
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<textarea
					value={row.text}
					onChange={(event) => onUpdate({ text: event.target.value })}
					className="min-h-14 w-full resize-none rounded-sm border border-[#264d78] bg-[#141a22] px-2 py-2 text-sm text-white outline-hidden"
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<TableSelect
					value={row.style}
					options={STYLE_OPTIONS}
					onChange={(style) => onUpdate({ style })}
					variant="green"
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<TableSelect
					value={row.emotion}
					options={EMOTION_OPTIONS}
					onChange={(emotion) => onUpdate({ emotion })}
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<TableSelect
					value={row.voiceModel}
					options={voiceModelOptions}
					onChange={(voiceModel) => onUpdate({ voiceModel })}
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<NumberInput
					value={row.speedPercent}
					onChange={(speedPercent) =>
						onUpdate({ speedPercent: clamp(speedPercent, 0, 300) })
					}
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<NumberInput
					value={row.pitchSemitones}
					onChange={(pitchSemitones) =>
						onUpdate({ pitchSemitones: clamp(pitchSemitones, -24, 24) })
					}
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<NumberInput
					value={row.echoPercent}
					onChange={(echoPercent) =>
						onUpdate({ echoPercent: clamp(echoPercent, 0, 100) })
					}
				/>
			</td>
			<td className="border-r border-[#0f345a] px-2 py-2">
				<Button
					size="sm"
					variant="outline"
					className="h-8 w-full border-[#1dff11] bg-[#173964] px-0 text-[#1dff11] hover:bg-[#1dff11]/15 hover:text-[#33ff33]"
					onClick={() => onPreview(row)}
				>
					{isSpeaking ? (
						<Square className="size-4 fill-current" />
					) : (
						<Play className="size-4 fill-current" />
					)}
				</Button>
			</td>
			<td className="px-2 py-2">
				<Button
					size="sm"
					variant="outline"
					className="h-8 w-full border-[#20d9ff] bg-[#173964] px-0 text-[#20d9ff] hover:bg-[#20d9ff]/15 hover:text-[#65e7ff]"
					onClick={() => onDownload(row)}
					disabled={isDownloading}
				>
					<Download className="size-4" />
				</Button>
			</td>
			<td className="px-2 py-2">
				<Button
					size="sm"
					variant="outline"
					className="h-8 w-full border-[#ff6b6b] bg-[#173964] px-0 text-[#ff8f8f] hover:bg-[#ff6b6b]/15 hover:text-[#ffb4b4]"
					onClick={onRemove}
				>
					<Trash2 className="size-4" />
				</Button>
			</td>
		</tr>
	);
}

export function TimelineTransitionPanel() {
	const editor = useEditor();
	const activeProject = useEditor((state) => state.project.getActive());
	const { selectedElements } = useElementSelection();
	const rows = useTimelineStore((state) => state.transitionTranscriptRows);
	const sourceLabel = useTimelineStore(
		(state) => state.transitionTranscriptSourceLabel,
	);
	const engineLabel = useTimelineStore(
		(state) => state.transitionTranscriptEngineLabel,
	);
	const setTransitionTranscript = useTimelineStore(
		(state) => state.setTransitionTranscript,
	);
	const updateRow = useTimelineStore(
		(state) => state.updateTransitionTranscriptRow,
	);
	const addRow = useTimelineStore((state) => state.addTransitionTranscriptRow);
	const removeRow = useTimelineStore(
		(state) => state.removeTransitionTranscriptRow,
	);
	const [speakingRowId, setSpeakingRowId] = useState<string | null>(null);
	const [downloadingRowId, setDownloadingRowId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const audioUrlRef = useRef<string | null>(null);
	const voiceModelOptions = useVoiceModelOptions();
	const buildAudioTask = useBackgroundTasksStore(
		(state) => state.tasksByKey[BUILD_AUDIO_TASK_KEY] ?? null,
	);
	const startTask = useBackgroundTasksStore((state) => state.startTask);
	const updateTask = useBackgroundTasksStore((state) => state.updateTask);
	const completeTask = useBackgroundTasksStore((state) => state.completeTask);
	const failTask = useBackgroundTasksStore((state) => state.failTask);
	const clearTask = useBackgroundTasksStore((state) => state.clearTask);
	useSyncTransitionCaptions();
	const hasRows = rows.length > 0;
	const isBuildingTimelineAudio = buildAudioTask?.status === "running";
	const summary = useMemo(
		() =>
			hasRows
				? `${rows.length} subtitle row${rows.length === 1 ? "" : "s"} from ${sourceLabel ?? "clip"}`
				: "Use Open Vibe UI or import an SRT file to build the table below.",
		[hasRows, rows.length, sourceLabel],
	);

	useEffect(() => {
		return () => {
			audioRef.current?.pause();
			if (audioUrlRef.current) {
				URL.revokeObjectURL(audioUrlRef.current);
			}
		};
	}, []);

	const requestRenderedAudio = async ({
		targetRows,
		requestSourceLabel,
		outputFormat,
		actingEngine,
	}: {
		targetRows: TransitionTranscriptRow[];
		requestSourceLabel: string;
		outputFormat: "wav" | "mp3";
		actingEngine: string;
	}): Promise<RenderedAudioPayload> => {
		const response = await fetch("/api/voice/render", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				rows: targetRows,
				sourceLabel: requestSourceLabel,
				outputFormat,
				actingEngine: normalizeTransitionActingEngine(actingEngine),
			}),
		});

		const responseText = await response.text();
		let payload:
			| {
					filename?: string;
					mimeType?: string;
					base64?: string;
					rows?: TransitionTranscriptRow[];
					renderMode?: "rvc" | "fallback";
			  }
			| undefined;
		let errorText = responseText || "Failed to render audio.";

		try {
			payload = JSON.parse(responseText) as typeof payload;
			if (payload?.filename && payload?.mimeType && payload?.base64) {
				errorText = "";
			} else if ("error" in (payload ?? {})) {
				errorText = String((payload as { error?: string }).error);
			}
		} catch {
			payload = undefined;
		}

		if (
			!response.ok ||
			!payload?.filename ||
			!payload?.mimeType ||
			!payload?.base64
		) {
			throw new Error(errorText);
		}

		return {
			filename: payload.filename,
			mimeType: payload.mimeType,
			base64: payload.base64,
			rows: payload.rows,
			renderMode: payload.renderMode,
		};
	};

	const handlePreview = (row: TransitionTranscriptRow) => {
		if (!row.text.trim()) {
			toast.error("This subtitle row is empty.");
			return;
		}

		if (speakingRowId === row.id) {
			audioRef.current?.pause();
			audioRef.current = null;
			if (audioUrlRef.current) {
				URL.revokeObjectURL(audioUrlRef.current);
				audioUrlRef.current = null;
			}
			setSpeakingRowId(null);
			return;
		}

		void (async () => {
			try {
				setSpeakingRowId(row.id);
				audioRef.current?.pause();
				if (audioUrlRef.current) {
					URL.revokeObjectURL(audioUrlRef.current);
					audioUrlRef.current = null;
				}

				const payload = await requestRenderedAudio({
					targetRows: [
						{
							...row,
							startSeconds: 0,
							endSeconds: Math.max(0.15, row.endSeconds - row.startSeconds),
						},
					],
					requestSourceLabel: sanitizeFilePart(row.id),
					outputFormat: "mp3",
					actingEngine: engineLabel,
				});

				const blob = decodeBase64File(payload.base64, payload.mimeType);
				const audioUrl = URL.createObjectURL(blob);
				const audio = new Audio(audioUrl);
				audioUrlRef.current = audioUrl;
				audioRef.current = audio;
				audio.onended = () => {
					setSpeakingRowId(null);
				};
				audio.onerror = () => {
					setSpeakingRowId(null);
					toast.error("Could not preview this subtitle row.");
				};
				await audio.play();
			} catch (caughtError) {
				setSpeakingRowId(null);
				console.error("Failed to preview row audio:", caughtError);
				toast.error(
					caughtError instanceof Error
						? caughtError.message
						: "Could not preview this subtitle row.",
				);
			}
		})();
	};

	const handleDownloadRow = (row: TransitionTranscriptRow) => {
		if (!row.text.trim()) {
			toast.error("This subtitle row is empty.");
			return;
		}

		void (async () => {
			try {
				setDownloadingRowId(row.id);
				const payload = await requestRenderedAudio({
					targetRows: [
						{
							...row,
							startSeconds: 0,
							endSeconds: Math.max(0.15, row.endSeconds - row.startSeconds),
						},
					],
					requestSourceLabel: sanitizeFilePart(row.id),
					outputFormat: "mp3",
					actingEngine: engineLabel,
				});
				const blob = decodeBase64File(payload.base64, payload.mimeType);
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = payload.filename ?? `${sanitizeFilePart(row.id)}.mp3`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(url);
			} catch (caughtError) {
				console.error("Failed to download row audio:", caughtError);
				toast.error(
					caughtError instanceof Error
						? caughtError.message
						: "Failed to download row audio.",
				);
			} finally {
				setDownloadingRowId(null);
			}
		})();
	};

	const handleCreateTimelineAudio = async () => {
		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		if (!hasRows) {
			toast.error("Create transcript rows first");
			return;
		}

		try {
			startTask({
				key: BUILD_AUDIO_TASK_KEY,
				title: "Build Audio",
				tabId: "transition",
				message: "Preparing timeline voice render...",
				detail: sourceLabel ?? "transition",
				progress: null,
			});
			const formatChoice = window.prompt(
				"Choose timeline audio format: wav or mp3",
				"wav",
			);
			if (formatChoice === null) {
				clearTask(BUILD_AUDIO_TASK_KEY);
				return;
			}
			const outputFormat = formatChoice.trim().toLowerCase();
			if (outputFormat !== "wav" && outputFormat !== "mp3") {
				clearTask(BUILD_AUDIO_TASK_KEY);
				toast.error("Please enter wav or mp3.");
				return;
			}

			updateTask(BUILD_AUDIO_TASK_KEY, {
				message: "Rendering voice track...",
			});
			const payload = await requestRenderedAudio({
				targetRows: rows,
				requestSourceLabel: sourceLabel ?? "transition",
				outputFormat,
				actingEngine: engineLabel,
			});

			const outputFile = new File(
				[decodeBase64File(payload.base64, payload.mimeType)],
				payload.filename,
				{
					type: payload.mimeType,
					lastModified: Date.now(),
				},
			);

			const processedAssets = await processMediaAssets({ files: [outputFile] });
			const processedAsset = processedAssets[0];
			if (!processedAsset) {
				throw new Error("Failed to process generated voice track.");
			}

			updateTask(BUILD_AUDIO_TASK_KEY, {
				message: "Saving generated audio...",
			});
			const createdAsset = await editor.media.addMediaAsset({
				projectId: activeProject.metadata.id,
				asset: processedAsset,
			});
			if (!createdAsset) {
				throw new Error("Failed to save generated voice track.");
			}

			const selectedTimelineElement =
				selectedElements.length === 1
					? (editor.timeline.getElementsWithTracks({
							elements: selectedElements,
						})[0]?.element ?? null)
					: null;
			const startTime =
				selectedTimelineElement &&
				(selectedTimelineElement.type === "audio" ||
					selectedTimelineElement.type === "video")
					? selectedTimelineElement.startTime
					: 0;

			const addTrackCommand = new AddTrackCommand("audio");
			const insertTrackId = addTrackCommand.getTrackId();
			const insertElementCommand = new InsertElementCommand({
				element: buildElementFromMedia({
					mediaId: createdAsset.id,
					mediaType: createdAsset.type,
					name: createdAsset.name,
					duration: createdAsset.duration ?? 1,
					startTime,
				}),
				placement: {
					mode: "explicit",
					trackId: insertTrackId,
				},
			});

			editor.command.execute({
				command: new BatchCommand([addTrackCommand, insertElementCommand]),
			});

			if (Array.isArray(payload.rows) && payload.rows.length > 0) {
				setTransitionTranscript({
					rows: payload.rows,
					sourceLabel,
					engineLabel,
				});
			}

			if (payload.renderMode === "fallback") {
				completeTask(BUILD_AUDIO_TASK_KEY, {
					message: "Audio added to timeline",
					detail: "Fallback TTS was used instead of full RVC conversion.",
				});
				toast.warning(
					"Audio was added with fallback TTS, not full RVC voice conversion. The .pth voice may not match exactly.",
				);
			} else {
				completeTask(BUILD_AUDIO_TASK_KEY, {
					message: "Audio added to timeline",
					detail: payload.filename,
				});
				toast.success("Voice track added to timeline");
			}
		} catch (caughtError) {
			console.error("Failed to create timeline audio:", caughtError);
			failTask(
				BUILD_AUDIO_TASK_KEY,
				"Build audio failed",
				caughtError instanceof Error
					? caughtError.message
					: "Failed to create timeline audio.",
			);
			toast.error(
				caughtError instanceof Error
					? caughtError.message
					: "Failed to create timeline audio.",
			);
		}
	};

	const handleAddRow = () => {
		const previousRow = rows.at(-1);
		const startSeconds = previousRow?.endSeconds ?? 0;
		const endSeconds = startSeconds + 2;

		addRow({
			id: `manual:${generateUUID()}`,
			startSeconds,
			endSeconds,
			originalText: "",
			text: "",
			style: "Adult",
			emotion: "natural",
			voiceModel: voiceModelOptions[0] ?? "Female.pth",
			speedPercent: 100,
			pitchSemitones: 0,
			echoPercent: 0,
			volumeDb: 0,
			audioLabel: sourceLabel ?? "Manual row",
		});
	};

	const handleAutoSpeed = () => {
		if (!hasRows) {
			toast.error("Create transcript rows first");
			return;
		}

		setTransitionTranscript({
			rows: rows.map((row) => ({
				...row,
				speedPercent: recommendRowSpeedPercent(row),
			})),
			sourceLabel,
			engineLabel,
		});
		toast.success(
			"Auto Speed tuned all rows for clearer speech. Build the timeline audio again to apply it.",
		);
	};

	const handleAutoEcho = () => {
		if (!hasRows) {
			toast.error("Create transcript rows first");
			return;
		}

		setTransitionTranscript({
			rows: rows.map((row) => ({
				...row,
				echoPercent: AUTO_ECHO_PERCENT,
			})),
			sourceLabel,
			engineLabel,
		});
		toast.success("Auto Echo reset every row to 0 for cleaner voice output.");
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#11161d] text-white">
			<div className="border-b border-[#0f345a] bg-[#173964] px-3 py-2">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-[#19d7ff]">
							{engineLabel}
						</div>
						<div className="truncate text-xs text-[#8ab8da]">{summary}</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							className="h-9 rounded-sm border border-[#5ae4ff] bg-[#0f253d] px-4 text-sm font-semibold text-[#5ae4ff] hover:bg-[#163d62]"
							onClick={() => void handleCreateTimelineAudio()}
							disabled={!hasRows || isBuildingTimelineAudio}
						>
							{isBuildingTimelineAudio
								? "Building Audio..."
								: "Get Audio To Timeline"}
						</Button>
						<Button
							className="h-9 rounded-sm border border-[#ffd166] bg-[#0f253d] px-4 text-sm font-semibold text-[#ffd166] hover:bg-[#163d62]"
							onClick={handleAddRow}
						>
							<Plus className="mr-2 size-4" />
							Add Row
						</Button>
						<Button
							className="h-9 rounded-sm border border-[#80ffdb] bg-[#0f253d] px-4 text-sm font-semibold text-[#80ffdb] hover:bg-[#163d62]"
							onClick={handleAutoSpeed}
							disabled={!hasRows}
						>
							Auto Speed
						</Button>
						<Button
							className="h-9 rounded-sm border border-[#fca5ff] bg-[#0f253d] px-4 text-sm font-semibold text-[#fca5ff] hover:bg-[#163d62]"
							onClick={handleAutoEcho}
							disabled={!hasRows}
						>
							Auto Echo
						</Button>
						<Button
							className="h-9 rounded-sm border border-[#7ce8ff] bg-[#0f253d] px-4 text-sm font-semibold text-[#7ce8ff] hover:bg-[#163d62]"
							onClick={() => downloadSrt(rows, sourceLabel)}
							disabled={!hasRows}
						>
							<Download className="mr-2 size-4" />
							Download SRT
						</Button>
						<Button
							className="h-9 rounded-sm border border-[#20d9ff] bg-[#0f253d] px-4 text-sm font-semibold text-[#20d9ff] hover:bg-[#163d62]"
							onClick={() => {
								audioRef.current?.pause();
								audioRef.current = null;
								if (audioUrlRef.current) {
									URL.revokeObjectURL(audioUrlRef.current);
									audioUrlRef.current = null;
								}
								setSpeakingRowId(null);
							}}
						>
							Stop
						</Button>
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				<table className="min-w-full border-collapse text-sm">
					<thead className="sticky top-0 z-10">
						<tr className="bg-[#173964] text-[#19d7ff]">
							<th className="w-14 border-r border-[#0f345a] px-3 py-3 text-left">
								#
							</th>
							<th className="w-36 border-r border-[#0f345a] px-3 py-3 text-left">
								Start
							</th>
							<th className="w-36 border-r border-[#0f345a] px-3 py-3 text-left">
								End
							</th>
							<th className="min-w-64 border-r border-[#0f345a] px-3 py-3 text-left">
								Text
							</th>
							<th className="w-32 border-r border-[#0f345a] px-3 py-3 text-left">
								Style
							</th>
							<th className="w-40 border-r border-[#0f345a] px-3 py-3 text-left">
								Emotion
							</th>
							<th className="w-56 border-r border-[#0f345a] px-3 py-3 text-left">
								Voice/Model
							</th>
							<th className="w-24 border-r border-[#0f345a] px-3 py-3 text-left">
								Speed%
							</th>
							<th className="w-20 border-r border-[#0f345a] px-3 py-3 text-left">
								Pitch
							</th>
							<th className="w-20 border-r border-[#0f345a] px-3 py-3 text-left">
								Echo%
							</th>
							<th className="w-20 border-r border-[#0f345a] px-3 py-3 text-left">
								Play
							</th>
							<th className="w-24 px-3 py-3 text-left">Download</th>
							<th className="w-24 px-3 py-3 text-left">Remove</th>
						</tr>
					</thead>
					<tbody>
						{hasRows ? (
							rows.map((row, index) => (
								<TransitionRow
									key={row.id}
									index={index}
									row={row}
									isSpeaking={speakingRowId === row.id}
									isDownloading={downloadingRowId === row.id}
									voiceModelOptions={voiceModelOptions}
									onPreview={handlePreview}
									onDownload={handleDownloadRow}
									onUpdate={(patch) => updateRow(row.id, patch)}
									onRemove={() => removeRow(row.id)}
								/>
							))
						) : (
							<tr className="bg-[#141a22]">
								<td
									colSpan={13}
									className="px-4 py-10 text-center text-sm text-[#8ab8da]"
								>
									No transcript rows yet. Open Vibe UI, or import an SRT file,
									then translate and edit rows here any time.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
