"use client";

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
} from "react";
import {
	AudioLines,
	Captions as CaptionsIcon,
	Copy,
	Download,
	FolderOpen,
	Link2,
	Mic,
	MoreHorizontal,
	Pause,
	Play,
	Printer,
	SkipBack,
	SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { hasMediaId } from "@/lib/timeline";
import type { MediaAsset } from "@/lib/media/types";
import {
	DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	MIN_CAPTION_DURATION_SECONDS,
	TRANSCRIPTION_LANGUAGES,
} from "@/constants/transcription-constants";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionResult,
} from "@/lib/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { DEFAULTS } from "@/lib/timeline/defaults";
import { CAPTION_STYLE_PRESETS, TEXT_STYLE_PRESETS } from "@/data/gsm-studio";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/lib/commands";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import type { AudioElement, VideoElement } from "@/lib/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useVoiceModelOptions } from "@/hooks/use-voice-model-options";

type SourceMode = "microphone" | "file" | "link";
type ExportFormat = "pdf" | "srt" | "txt" | "json" | "html" | "vtt" | "csv";

const decodedAudioCache = new Map<
	string,
	Promise<{ samples: Float32Array; sampleRate: number }>
>();
const transcriptionResultCache = new Map<string, TranscriptionResult>();
const IMPORTED_CAPTION_FONT_DIVISOR = 8;
const MIN_IMPORTED_CAPTION_FONT_SIZE = 1.8;
const MAX_IMPORTED_CAPTION_FONT_SIZE = 3.2;

const CAPTION_MOTION_OPTIONS = [
	{
		id: "none",
		name: "None",
		description: "Static subtitle blocks for clean editorial work.",
	},
	{
		id: "pop-in",
		name: "Pop In",
		description: "Short-form social style entrance treatment.",
	},
	{
		id: "slide-up",
		name: "Slide Up",
		description: "Softer motion for explainers and talking-head edits.",
	},
] as const;

function formatDuration(totalSeconds: number) {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
		return "0:00";
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSrtTimestamp(totalSeconds: number) {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const milliseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function buildTranscriptText(result: TranscriptionResult | null) {
	return result?.segments.map((segment) => segment.text.trim()).join("\n") ?? "";
}

function buildTranscriptPreview({
	result,
	exportFormat,
}: {
	result: TranscriptionResult | null;
	exportFormat: ExportFormat;
}) {
	if (!result) {
		return "";
	}

	switch (exportFormat) {
		case "srt":
			return buildSrt(result);
		case "vtt":
			return buildVtt(result);
		case "csv":
			return buildCsv(result);
		case "json":
			return JSON.stringify(result, null, 2);
		case "html":
			return buildHtml(result);
		case "txt":
		case "pdf":
		default:
			return buildTranscriptText(result);
	}
}

function buildSrt(result: TranscriptionResult) {
	return result.segments
		.map(
			(segment, index) =>
				`${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text.trim()}\n`,
		)
		.join("\n");
}

function buildVtt(result: TranscriptionResult) {
	return `WEBVTT\n\n${result.segments
		.map(
			(segment) =>
				`${formatSrtTimestamp(segment.start).replace(",", ".")} --> ${formatSrtTimestamp(segment.end).replace(",", ".")}\n${segment.text.trim()}\n`,
		)
		.join("\n")}`;
}

function escapeCsvValue(value: string) {
	return `"${value.replaceAll('"', '""')}"`;
}

function buildCsv(result: TranscriptionResult) {
	return [
		"index,start,end,text",
		...result.segments.map((segment, index) =>
			[
				String(index + 1),
				formatSrtTimestamp(segment.start),
				formatSrtTimestamp(segment.end),
				escapeCsvValue(segment.text.trim()),
			].join(","),
		),
	].join("\n");
}

function buildHtml(result: TranscriptionResult) {
	const lines = result.segments
		.map(
			(segment) =>
				`<p><strong>${formatSrtTimestamp(segment.start)} - ${formatSrtTimestamp(segment.end)}</strong><br/>${segment.text.trim()}</p>`,
		)
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"/><title>Transcript</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;">${lines}</body></html>`;
}

function downloadTextFile({
	content,
	filename,
	type,
}: {
	content: string;
	filename: string;
	type: string;
}) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function downloadBlobFile({ blob, filename }: { blob: Blob; filename: string }) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function getBlobCacheKey(blob: Blob, sampleRate: number, label: string) {
	const file = blob instanceof File ? blob : null;
	return [
		label,
		file?.name ?? "blob",
		blob.size,
		file?.lastModified ?? 0,
		blob.type,
		sampleRate,
	].join(":");
}

function extractSelectedClipSamples({
	samples,
	sampleRate,
	element,
	assetDurationSeconds,
}: {
	samples: Float32Array;
	sampleRate: number;
	element: AudioElement | VideoElement | null;
	assetDurationSeconds?: number;
}) {
	if (!element) {
		return samples;
	}

	const totalSourceSeconds =
		(typeof element.sourceDuration === "number" && element.sourceDuration > 0
			? element.sourceDuration / TICKS_PER_SECOND
			: assetDurationSeconds) ?? samples.length / sampleRate;
	const trimStartSeconds = Math.max(0, element.trimStart / TICKS_PER_SECOND);
	const trimEndSeconds = Math.max(0, element.trimEnd / TICKS_PER_SECOND);
	const clipStartSeconds = Math.min(trimStartSeconds, totalSourceSeconds);
	const clipEndSeconds = Math.max(
		clipStartSeconds,
		totalSourceSeconds - trimEndSeconds,
	);
	const startSample = Math.max(
		0,
		Math.min(samples.length, Math.floor(clipStartSeconds * sampleRate)),
	);
	const endSample = Math.max(
		startSample,
		Math.min(samples.length, Math.ceil(clipEndSeconds * sampleRate)),
	);

	return samples.slice(startSample, endSample);
}

async function getDecodedAudioForBlob({
	blob,
	sampleRate,
	label,
}: {
	blob: Blob;
	sampleRate: number;
	label: string;
}) {
	const cacheKey = getBlobCacheKey(blob, sampleRate, label);
	const cached = decodedAudioCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const nextPromise = decodeAudioToFloat32({
		audioBlob: blob,
		sampleRate,
	}).catch((error) => {
		decodedAudioCache.delete(cacheKey);
		throw error;
	});
	decodedAudioCache.set(cacheKey, nextPromise);
	return nextPromise;
}

function buildImportedCaptionStyle({
	textPreset,
}: {
	textPreset:
		| (typeof TEXT_STYLE_PRESETS)[number]
		| null;
}) {
	const rawFontSize = textPreset?.fontSize ?? 18;
	const fontSize = Math.min(
		MAX_IMPORTED_CAPTION_FONT_SIZE,
		Math.max(
			MIN_IMPORTED_CAPTION_FONT_SIZE,
			rawFontSize / IMPORTED_CAPTION_FONT_DIVISOR,
		),
	);

	const background = textPreset?.background
		? {
				...textPreset.background,
				paddingX: Math.max(
					4,
					Math.round((textPreset.background.paddingX ?? 24) / 6),
				),
				paddingY: Math.max(
					2,
					Math.round((textPreset.background.paddingY ?? 16) / 6),
				),
			}
		: {
				...DEFAULTS.text.element.background,
				enabled: false,
				color: "transparent",
			};

	return {
		fontSize,
		fontFamily: textPreset?.fontFamily ?? DEFAULTS.text.element.fontFamily,
		color: textPreset?.color ?? "#ffffff",
		fontWeight: textPreset?.fontWeight ?? "bold",
		fontStyle: textPreset?.fontStyle ?? DEFAULTS.text.element.fontStyle,
		textDecoration:
			textPreset?.textDecoration ?? DEFAULTS.text.element.textDecoration,
		letterSpacing:
			textPreset?.letterSpacing ?? DEFAULTS.text.element.letterSpacing,
		lineHeight: textPreset?.lineHeight ?? DEFAULTS.text.element.lineHeight,
		background,
	};
}

export function TranscriptionView() {
	const editor = useEditor();
	const mediaAssets = useEditor((currentEditor) => currentEditor.media.getAssets());
	const voiceModelOptions = useVoiceModelOptions();
	const setTransitionTranscript = useTimelineStore(
		(state) => state.setTransitionTranscript,
	);
	const setTimelineEditorMode = useTimelineStore(
		(state) => state.setEditorMode,
	);
	const { selectedElements } = useElementSelection();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const mediaPreviewRef = useRef<HTMLMediaElement>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const [sourceMode, setSourceMode] = useState<SourceMode>("file");
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedStyle, setSelectedStyle] =
		useState<(typeof CAPTION_STYLE_PRESETS)[number]["id"]>("bold-yellow");
	const [selectedMotion, setSelectedMotion] =
		useState<(typeof CAPTION_MOTION_OPTIONS)[number]["id"]>("pop-in");
	const [externalFile, setExternalFile] = useState<File | null>(null);
	const [externalFileUrl, setExternalFileUrl] = useState<string | null>(null);
	const [linkUrl, setLinkUrl] = useState("");
	const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
	const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
	const [selectedSpeakerId, setSelectedSpeakerId] = useState("");
	const [recordedAudio, setRecordedAudio] = useState<File | null>(null);
	const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
	const [saveRecordingLocally, setSaveRecordingLocally] = useState(true);
	const [isRecording, setIsRecording] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingStep, setProcessingStep] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [transcriptionResult, setTranscriptionResult] =
		useState<TranscriptionResult | null>(null);
	const [exportFormat, setExportFormat] = useState<ExportFormat>("srt");
	const [showMoreOptions, setShowMoreOptions] = useState(false);
	const [playbackTime, setPlaybackTime] = useState(0);
	const [playbackDuration, setPlaybackDuration] = useState(0);
	const [isPlayingPreview, setIsPlayingPreview] = useState(false);

	const selectedElementWithTrack =
		selectedElements.length === 1
			? (editor.timeline.getElementsWithTracks({
					elements: selectedElements,
				})[0] ?? null)
			: null;
	const selectedTimelineElement = selectedElementWithTrack?.element ?? null;
	const selectedAsset =
		selectedTimelineElement && hasMediaId(selectedTimelineElement)
			? (mediaAssets.find((asset) => asset.id === selectedTimelineElement.mediaId) ??
				null)
			: null;
	const preferredTimelineMedia = useMemo(
		() => ({
			element:
				selectedTimelineElement &&
				(selectedTimelineElement.type === "audio" ||
					selectedTimelineElement.type === "video")
					? selectedTimelineElement
					: null,
			asset: selectedAsset,
		}),
		[selectedAsset, selectedTimelineElement],
	);

	const selectedStylePreset = useMemo(
		() =>
			CAPTION_STYLE_PRESETS.find((preset) => preset.id === selectedStyle) ??
			CAPTION_STYLE_PRESETS[0],
		[selectedStyle],
	);
	const selectedTextPreset = useMemo(
		() =>
			TEXT_STYLE_PRESETS.find(
				(preset) => preset.id === selectedStylePreset.textPresetId,
			) ?? null,
		[selectedStylePreset],
	);
	const selectedMotionPreset = useMemo(
		() =>
			CAPTION_MOTION_OPTIONS.find((motion) => motion.id === selectedMotion) ??
			CAPTION_MOTION_OPTIONS[0],
		[selectedMotion],
	);

	const activeFile = sourceMode === "microphone" ? recordedAudio : externalFile;
	const activeFileUrl = sourceMode === "microphone" ? recordedAudioUrl : externalFileUrl;
	const currentAssetFile =
		sourceMode === "file"
			? activeFile ?? preferredTimelineMedia.asset?.file ?? null
			: null;
	const currentAssetUrl =
		sourceMode === "file"
			? activeFileUrl ?? preferredTimelineMedia.asset?.url ?? null
			: null;
	const currentAssetName =
		sourceMode === "file"
			? activeFile?.name ??
				preferredTimelineMedia.element?.name ??
				preferredTimelineMedia.asset?.name ??
				"No file selected"
			: sourceMode === "microphone"
				? recordedAudio?.name ?? "Recorded audio"
				: linkUrl || "Direct media URL";
	const currentAssetType =
		sourceMode === "file"
			? activeFile?.type.startsWith("video/")
				? "video"
				: activeFile?.type.startsWith("audio/")
					? "audio"
					: preferredTimelineMedia.asset?.type ?? null
			: sourceMode === "microphone"
				? "audio"
				: null;
	const transcriptText = useMemo(
		() =>
			buildTranscriptPreview({
				result: transcriptionResult,
				exportFormat,
			}),
		[exportFormat, transcriptionResult],
	);

	useEffect(() => {
		return () => {
			if (externalFileUrl) {
				URL.revokeObjectURL(externalFileUrl);
			}
			if (recordedAudioUrl) {
				URL.revokeObjectURL(recordedAudioUrl);
			}
			mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
		};
	}, [externalFileUrl, recordedAudioUrl]);

	useEffect(() => {
		if (!navigator.mediaDevices?.enumerateDevices) {
			return;
		}

		const syncDevices = async () => {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				const inputs = devices.filter((device) => device.kind === "audioinput");
				const outputs = devices.filter((device) => device.kind === "audiooutput");
				setMicrophoneDevices(inputs);
				setSpeakerDevices(outputs);
				if (!selectedMicrophoneId && inputs[0]) {
					setSelectedMicrophoneId(inputs[0].deviceId);
				}
				if (!selectedSpeakerId && outputs[0]) {
					setSelectedSpeakerId(outputs[0].deviceId);
				}
			} catch (caughtError) {
				console.error("Failed to enumerate devices:", caughtError);
			}
		};

		void syncDevices();
	}, [selectedMicrophoneId, selectedSpeakerId]);

	useEffect(() => {
		const element = mediaPreviewRef.current;
		if (!element || !selectedSpeakerId || !("setSinkId" in element)) {
			return;
		}

		void (element as HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId?.(selectedSpeakerId).catch(
			(caughtError) => {
				console.error("Failed to set audio output device:", caughtError);
			},
		);
	}, [selectedSpeakerId, currentAssetUrl, recordedAudioUrl]);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			setProcessingStep(`Loading Vibe ${Math.round(progress.progress)}%`);
			return;
		}
		if (progress.status === "transcribing") {
			setProcessingStep("Transcribing selected source...");
		}
	};

	const handleChooseFile = () => {
		fileInputRef.current?.click();
	};

	const handleExternalFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const nextFile = event.target.files?.[0] ?? null;
		if (!nextFile) {
			return;
		}
		if (externalFileUrl) {
			URL.revokeObjectURL(externalFileUrl);
		}
		const nextUrl = URL.createObjectURL(nextFile);
		setExternalFile(nextFile);
		setExternalFileUrl(nextUrl);
		setSourceMode("file");
		setTranscriptionResult(null);
		setError(null);
	};

	const toggleRecording = async () => {
		if (isRecording) {
			mediaRecorderRef.current?.stop();
			setIsRecording(false);
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: selectedMicrophoneId
					? { deviceId: { exact: selectedMicrophoneId } }
					: true,
			});
			mediaStreamRef.current = stream;
			const recorder = new MediaRecorder(stream);
			const chunks: BlobPart[] = [];
			recorder.addEventListener("dataavailable", (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			});
			recorder.addEventListener("stop", () => {
				const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
				const file = new File([blob], `vibe-recording-${Date.now()}.webm`, {
					type: blob.type,
					lastModified: Date.now(),
				});
				if (recordedAudioUrl) {
					URL.revokeObjectURL(recordedAudioUrl);
				}
				const nextUrl = URL.createObjectURL(file);
				setRecordedAudio(file);
				setRecordedAudioUrl(nextUrl);
				setSourceMode("microphone");
				setTranscriptionResult(null);
				setError(null);

				if (saveRecordingLocally) {
					downloadBlobFile({
						blob,
						filename: file.name,
					});
				}

				stream.getTracks().forEach((track) => track.stop());
				mediaStreamRef.current = null;
			});
			mediaRecorderRef.current = recorder;
			recorder.start();
			setIsRecording(true);
			toast.success("Recording started");
		} catch (caughtError) {
			console.error("Recording failed:", caughtError);
			toast.error("Could not start microphone recording");
		}
	};

	const resolveSourceBlob = async () => {
		if (sourceMode === "microphone") {
			return recordedAudio;
		}

		if (sourceMode === "file") {
			if (currentAssetFile) {
				return currentAssetFile;
			}

			if (currentAssetUrl) {
				const response = await fetch(currentAssetUrl);
				if (!response.ok) {
					throw new Error(`Failed to load selected clip: ${response.statusText}`);
				}
				const blob = await response.blob();
				return new File([blob], currentAssetName, {
					type:
						blob.type ||
						(currentAssetType === "video" ? "video/mp4" : "audio/mpeg"),
					lastModified: Date.now(),
				});
			}

			return null;
		}

		if (!linkUrl.trim()) {
			throw new Error("Enter a direct media URL first.");
		}

		const response = await fetch(linkUrl.trim());
		if (!response.ok) {
			throw new Error(`Failed to fetch media URL: ${response.statusText}`);
		}
		const blob = await response.blob();
		return new File([blob], "vibe-link-source", {
			type: blob.type || "audio/mpeg",
			lastModified: Date.now(),
		});
	};

	const handleTranscribe = async () => {
		try {
			setIsProcessing(true);
			setError(null);
			setTranscriptionResult(null);
			setProcessingStep("Preparing source...");

			const sourceBlob = await resolveSourceBlob();
			if (!sourceBlob) {
				throw new Error("No source selected for transcription.");
			}

			const clipIdentity = preferredTimelineMedia.element
				? [
						preferredTimelineMedia.element.id,
						preferredTimelineMedia.element.startTime,
						preferredTimelineMedia.element.duration,
						preferredTimelineMedia.element.trimStart,
						preferredTimelineMedia.element.trimEnd,
					].join(":")
				: "full-source";
			const cacheKey = [
				getBlobCacheKey(
					sourceBlob,
					DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
					currentAssetName,
				),
				sourceMode,
				clipIdentity,
				selectedLanguage,
			].join("|");
			const cachedResult = transcriptionResultCache.get(cacheKey);
			if (cachedResult) {
				setProcessingStep("Using cached transcript...");
				setTranscriptionResult(cachedResult);
				toast.success("Transcription loaded from cache");
				return;
			}

			setProcessingStep("Decoding source audio...");
			const { samples, sampleRate } = await getDecodedAudioForBlob({
				blob: sourceBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
				label: currentAssetName,
			});
			setProcessingStep("Extracting clip audio...");
			const clipSamples =
				sourceMode === "file"
					? extractSelectedClipSamples({
							samples,
							sampleRate,
							element: preferredTimelineMedia.element,
							assetDurationSeconds: preferredTimelineMedia.asset?.duration,
						})
					: samples;

			setProcessingStep("Running transcription...");
			const result = await transcriptionService.transcribe({
				audioData: clipSamples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: handleProgress,
			});

			if (result.segments.length === 0) {
				throw new Error("No speech detected in the selected source.");
			}

			setProcessingStep("Finalizing transcript...");
			transcriptionResultCache.set(cacheKey, result);
			setTranscriptionResult(result);
			toast.success("Transcription completed");
		} catch (caughtError) {
			console.error("Vibe transcription failed:", caughtError);
			const message =
				caughtError instanceof Error
					? caughtError.message
					: "An unexpected error occurred";
			setError(message);
			toast.error(message);
		} finally {
			setIsProcessing(false);
			setProcessingStep("");
		}
	};

	const handleAddCaptionsToTimeline = () => {
		if (!transcriptionResult) {
			return;
		}

		const timedSegments = transcriptionResult.segments.filter(
			(segment) => segment.text.trim().length > 0 && segment.end > segment.start,
		);
		if (timedSegments.length === 0) {
			toast.error("No timed transcript segments available");
			return;
		}

		const importedCaptionStyle = buildImportedCaptionStyle({
			textPreset: selectedTextPreset,
		});
		const addTrackCommand = new AddTrackCommand("text", 0);
		const insertCommands = timedSegments.map((segment, index) => {
			const startTimeTicks = Math.round(segment.start * TICKS_PER_SECOND);
			const durationTicks = Math.max(
				1,
				Math.round(
					Math.max(MIN_CAPTION_DURATION_SECONDS, segment.end - segment.start) *
						TICKS_PER_SECOND,
				),
			);

			return new InsertElementCommand({
				placement: {
					mode: "explicit",
					trackId: addTrackCommand.getTrackId(),
				},
				element: {
					...DEFAULTS.text.element,
					name: `Vibe Caption ${index + 1}`,
					content: segment.text.trim(),
					duration: durationTicks,
					startTime: startTimeTicks,
					fontSize: importedCaptionStyle.fontSize,
					fontFamily: importedCaptionStyle.fontFamily,
					color: importedCaptionStyle.color,
					fontWeight: importedCaptionStyle.fontWeight,
					fontStyle: importedCaptionStyle.fontStyle,
					textDecoration: importedCaptionStyle.textDecoration,
					letterSpacing: importedCaptionStyle.letterSpacing,
					lineHeight: importedCaptionStyle.lineHeight,
					background: importedCaptionStyle.background,
				},
			});
		});

		editor.command.execute({
			command: new BatchCommand([addTrackCommand, ...insertCommands]),
		});

		setTransitionTranscript({
			rows: timedSegments.map((segment, index) => ({
				id: `vibe:${currentAssetName}:${index}`,
				startSeconds: segment.start,
				endSeconds: segment.end,
				originalText: segment.text.trim(),
				text: segment.text.trim(),
				style: "Adult",
				emotion: "natural",
				voiceModel: voiceModelOptions[0] ?? "Female.pth",
				speedPercent: 100,
				pitchSemitones: 0,
				echoPercent: 0,
				volumeDb: 0,
				audioLabel: currentAssetName,
			})),
			sourceLabel: currentAssetName,
			engineLabel: "StyleTTS2",
		});
		editor.selection.clearSelection();
		setTimelineEditorMode("timeline");
		toast.success("Captions added to timeline");
	};

	const handleCopyTranscript = async () => {
		if (!transcriptText) {
			return;
		}
		await navigator.clipboard.writeText(transcriptText);
		toast.success("Transcript copied");
	};

	const handleDownloadTranscript = () => {
		if (!transcriptionResult) {
			return;
		}

		if (exportFormat === "pdf") {
			const printWindow = window.open("", "_blank", "width=900,height=700");
			if (!printWindow) {
				toast.error("Unable to open print window");
				return;
			}
			printWindow.document.write(buildHtml(transcriptionResult));
			printWindow.document.close();
			printWindow.focus();
			printWindow.print();
			return;
		}

		switch (exportFormat) {
			case "srt":
				downloadTextFile({
					content: buildSrt(transcriptionResult),
					filename: "vibe-transcript.srt",
					type: "text/plain;charset=utf-8",
				});
				break;
			case "vtt":
				downloadTextFile({
					content: buildVtt(transcriptionResult),
					filename: "vibe-transcript.vtt",
					type: "text/vtt;charset=utf-8",
				});
				break;
			case "txt":
				downloadTextFile({
					content: transcriptText,
					filename: "vibe-transcript.txt",
					type: "text/plain;charset=utf-8",
				});
				break;
			case "csv":
				downloadTextFile({
					content: buildCsv(transcriptionResult),
					filename: "vibe-transcript.csv",
					type: "text/csv;charset=utf-8",
				});
				break;
			case "json":
				downloadTextFile({
					content: JSON.stringify(transcriptionResult, null, 2),
					filename: "vibe-transcript.json",
					type: "application/json;charset=utf-8",
				});
				break;
			case "html":
				downloadTextFile({
					content: buildHtml(transcriptionResult),
					filename: "vibe-transcript.html",
					type: "text/html;charset=utf-8",
				});
				break;
		}
	};

	const handlePrintTranscript = () => {
		if (!transcriptionResult) {
			return;
		}
		const printWindow = window.open("", "_blank", "width=900,height=700");
		if (!printWindow) {
			toast.error("Unable to open print window");
			return;
		}
		printWindow.document.write(buildHtml(transcriptionResult));
		printWindow.document.close();
		printWindow.focus();
		printWindow.print();
	};

	const handlePreviewTimeUpdate = () => {
		const element = mediaPreviewRef.current;
		if (!element) {
			return;
		}
		setPlaybackTime(element.currentTime);
		setPlaybackDuration(element.duration || 0);
		setIsPlayingPreview(!element.paused);
	};

	const togglePreviewPlayback = async () => {
		const element = mediaPreviewRef.current;
		if (!element) {
			return;
		}
		if (element.paused) {
			await element.play();
		} else {
			element.pause();
		}
		setIsPlayingPreview(!element.paused);
	};

	const seekPreview = (deltaSeconds: number) => {
		const element = mediaPreviewRef.current;
		if (!element) {
			return;
		}
		element.currentTime = Math.max(
			0,
			Math.min((element.duration || 0) + deltaSeconds, element.currentTime + deltaSeconds),
		);
		setPlaybackTime(element.currentTime);
	};

	const currentPreviewUrl =
		sourceMode === "microphone" ? recordedAudioUrl : sourceMode === "file" ? currentAssetUrl : null;

	return (
		<PanelView
			title="Vibe"
			contentClassName="px-0 flex flex-col h-full"
			scrollClassName="pb-4"
			actions={
				<Button variant="ghost" size="icon" aria-label="More options">
					<MoreHorizontal className="size-4" />
				</Button>
			}
		>
			<div className="space-y-5 px-3 pb-3">
				<input
					ref={fileInputRef}
					type="file"
					accept="audio/*,video/*"
					className="hidden"
					onChange={handleExternalFileChange}
				/>

				<div className="flex justify-center">
					<div className="inline-flex rounded-2xl border bg-background p-1 shadow-sm">
						<Button
							variant={sourceMode === "microphone" ? "secondary" : "ghost"}
							size="icon"
							className="size-11 rounded-xl"
							onClick={() => setSourceMode("microphone")}
						>
							<Mic className="size-5" />
						</Button>
						<Button
							variant={sourceMode === "file" ? "secondary" : "ghost"}
							size="icon"
							className="size-11 rounded-xl"
							onClick={() => setSourceMode("file")}
						>
							<FolderOpen className="size-5" />
						</Button>
						<Button
							variant={sourceMode === "link" ? "secondary" : "ghost"}
							size="icon"
							className="size-11 rounded-xl"
							onClick={() => setSourceMode("link")}
						>
							<Link2 className="size-5" />
						</Button>
					</div>
				</div>

				<div className="space-y-3">
					<div className="text-sm font-medium">Language</div>
					<Select
						value={selectedLanguage}
						onValueChange={(value) =>
							setSelectedLanguage(value as TranscriptionLanguage)
						}
					>
						<SelectTrigger className="h-12 rounded-2xl">
							<SelectValue placeholder="Auto Detect" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="auto">Auto Detect</SelectItem>
							{TRANSCRIPTION_LANGUAGES.map((language) => (
								<SelectItem key={language.code} value={language.code}>
									{language.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{sourceMode === "microphone" ? (
					<div className="space-y-4 rounded-[1.75rem] border bg-background p-4 shadow-sm">
						<div className="space-y-3">
							<div className="text-sm font-medium">Microphone</div>
							<Select
								value={selectedMicrophoneId}
								onValueChange={setSelectedMicrophoneId}
							>
								<SelectTrigger className="h-12 rounded-2xl">
									<SelectValue placeholder="Choose microphone" />
								</SelectTrigger>
								<SelectContent>
									{microphoneDevices.map((device) => (
										<SelectItem key={device.deviceId} value={device.deviceId}>
											{device.label || "Microphone"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-3">
							<div className="text-sm font-medium">Speakers</div>
							<Select value={selectedSpeakerId} onValueChange={setSelectedSpeakerId}>
								<SelectTrigger className="h-12 rounded-2xl">
									<SelectValue placeholder="Choose speakers" />
								</SelectTrigger>
								<SelectContent>
									{speakerDevices.map((device) => (
										<SelectItem key={device.deviceId} value={device.deviceId}>
											{device.label || "Speakers"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="flex items-center justify-between rounded-2xl border px-4 py-3">
							<div className="text-sm text-muted-foreground">
								Save audio file in documents
							</div>
							<Switch
								checked={saveRecordingLocally}
								onCheckedChange={setSaveRecordingLocally}
							/>
						</div>

						<Button
							className="h-12 w-full rounded-2xl text-base"
							onClick={toggleRecording}
						>
							{isRecording ? "Stop recording" : "Record and transcribe"}
						</Button>
					</div>
				) : null}

				{sourceMode === "file" ? (
					<div className="space-y-4 rounded-[1.75rem] border bg-background p-4 shadow-sm">
						<div className="flex items-center gap-3">
							<div className="rounded-2xl bg-primary/10 p-3 text-primary">
								<AudioLines className="size-5" />
							</div>
							<div className="min-w-0">
								<div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
									Now Playing
								</div>
								<div className="truncate text-2xl font-semibold">
									{currentAssetName}
								</div>
							</div>
						</div>

						{currentPreviewUrl ? (
							<>
								{currentAssetType === "video" ? (
									<video
										ref={mediaPreviewRef as React.RefObject<HTMLVideoElement>}
										src={currentPreviewUrl}
										className="hidden"
										onLoadedMetadata={handlePreviewTimeUpdate}
										onTimeUpdate={handlePreviewTimeUpdate}
										onPlay={handlePreviewTimeUpdate}
										onPause={handlePreviewTimeUpdate}
									/>
								) : (
									<audio
										ref={mediaPreviewRef as React.RefObject<HTMLAudioElement>}
										src={currentPreviewUrl}
										className="hidden"
										onLoadedMetadata={handlePreviewTimeUpdate}
										onTimeUpdate={handlePreviewTimeUpdate}
										onPlay={handlePreviewTimeUpdate}
										onPause={handlePreviewTimeUpdate}
									/>
								)}

								<input
									type="range"
									min={0}
									max={playbackDuration || 0}
									step={0.01}
									value={playbackTime}
									onChange={(event) => {
										const element = mediaPreviewRef.current;
										if (!element) return;
										element.currentTime = Number(event.target.value);
										setPlaybackTime(element.currentTime);
									}}
									className="w-full"
								/>
								<div className="flex items-center justify-between text-sm text-muted-foreground">
									<span>{formatDuration(playbackTime)}</span>
									<span>{formatDuration(playbackDuration)}</span>
								</div>
								<div className="flex items-center justify-center gap-4">
									<Button variant="ghost" size="icon" onClick={() => seekPreview(-5)}>
										<SkipBack className="size-5" />
									</Button>
									<Button
										size="icon"
										className="size-14 rounded-full"
										onClick={togglePreviewPlayback}
									>
										{isPlayingPreview ? (
											<Pause className="size-6" />
										) : (
											<Play className="size-6" />
										)}
									</Button>
									<Button variant="ghost" size="icon" onClick={() => seekPreview(5)}>
										<SkipForward className="size-5" />
									</Button>
								</div>
							</>
						) : (
							<div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
								Select a clip on the timeline or choose a file to start.
							</div>
						)}

						<Button variant="link" className="justify-start" onClick={handleChooseFile}>
							Change File
						</Button>
					</div>
				) : null}

				{sourceMode === "link" ? (
					<div className="space-y-4 rounded-[1.75rem] border bg-background p-4 shadow-sm">
						<div className="text-sm font-medium">Direct media link</div>
						<Input
							value={linkUrl}
							onChange={(event) => setLinkUrl(event.target.value)}
							placeholder="https://example.com/audio.mp3"
							className="h-12 rounded-2xl"
						/>
						<div className="text-sm text-muted-foreground">
							Use a direct audio or video file URL. Website pages like YouTube
							still need a separate downloader backend.
						</div>
					</div>
				) : null}

				<Button
					className="h-14 w-full rounded-2xl text-lg"
					onClick={sourceMode === "microphone" && !recordedAudio ? toggleRecording : handleTranscribe}
					disabled={isProcessing}
				>
					{isProcessing ? <Spinner className="mr-2" /> : null}
					{isProcessing
						? processingStep
						: sourceMode === "microphone" && !recordedAudio
							? "Record and transcribe"
							: "Transcribe"}
				</Button>

				<Button
					variant="outline"
					className="rounded-2xl"
					onClick={() => setShowMoreOptions((value) => !value)}
				>
					More Options
				</Button>

				{showMoreOptions ? (
					<div className="space-y-4 rounded-[1.5rem] border bg-background p-4">
						<div className="space-y-2">
							<div className="text-sm font-medium">Caption style</div>
							<Select
								value={selectedStyle}
								onValueChange={(value) =>
									setSelectedStyle(
										value as (typeof CAPTION_STYLE_PRESETS)[number]["id"],
									)
								}
							>
								<SelectTrigger className="h-11 rounded-2xl">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_STYLE_PRESETS.map((preset) => (
										<SelectItem key={preset.id} value={preset.id}>
											{preset.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Caption motion</div>
							<Select
								value={selectedMotion}
								onValueChange={(value) =>
									setSelectedMotion(
										value as (typeof CAPTION_MOTION_OPTIONS)[number]["id"],
									)
								}
							>
								<SelectTrigger className="h-11 rounded-2xl">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_MOTION_OPTIONS.map((motion) => (
										<SelectItem key={motion.id} value={motion.id}>
											{motion.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="text-xs text-muted-foreground">
								{selectedMotionPreset.description}
							</div>
						</div>
					</div>
				) : null}

				{error ? (
					<div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
						{error}
					</div>
				) : null}

				<div className="rounded-[1.75rem] border bg-accent/10 p-4">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="icon" onClick={handleCopyTranscript} disabled={!transcriptionResult}>
								<Copy className="size-4" />
							</Button>
							<Button variant="ghost" size="icon" onClick={handleDownloadTranscript} disabled={!transcriptionResult}>
								<Download className="size-4" />
							</Button>
							<Button variant="ghost" size="icon" onClick={handlePrintTranscript} disabled={!transcriptionResult}>
								<Printer className="size-4" />
							</Button>
							<Button variant="ghost" size="icon" onClick={handleAddCaptionsToTimeline} disabled={!transcriptionResult}>
								<CaptionsIcon className="size-4" />
							</Button>
						</div>
						<Select
							value={exportFormat}
							onValueChange={(value) => setExportFormat(value as ExportFormat)}
						>
							<SelectTrigger className="h-11 w-28 rounded-2xl bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="pdf">pdf</SelectItem>
								<SelectItem value="srt">srt</SelectItem>
								<SelectItem value="vtt">vtt</SelectItem>
								<SelectItem value="txt">txt</SelectItem>
								<SelectItem value="csv">csv</SelectItem>
								<SelectItem value="json">json</SelectItem>
								<SelectItem value="html">html</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="rounded-2xl border bg-background p-4">
						<div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
							Vibe Transcript
						</div>
						<textarea
							value={transcriptText}
							readOnly
							className="min-h-56 w-full resize-y rounded-xl border bg-transparent p-3 text-sm outline-none"
							placeholder="Transcript preview will appear here after transcription."
						/>
					</div>
				</div>
			</div>
		</PanelView>
	);
}
