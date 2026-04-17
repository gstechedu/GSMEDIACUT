"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { MediaAsset } from "@/lib/media/types";
import type { AudioElement, VideoElement } from "@/lib/timeline";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { transcriptionService } from "@/services/transcription/service";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/lib/transcription/types";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/constants/transcription-constants";
import {
	normalizeTransitionActingEngine,
	TRANSITION_ACTING_ENGINES,
	useTimelineStore,
} from "@/stores/timeline-store";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";
import { useSyncTransitionCaptions } from "../../timeline/transition-caption-sync";
import { useVoiceModelOptions } from "@/hooks/use-voice-model-options";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";

const decodedAudioCache = new Map<
	string,
	Promise<{ samples: Float32Array; sampleRate: number }>
>();

const TRANSITION_LANGUAGES = [
	{ value: "km", label: "Khmer (KM)" },
	{ value: "en", label: "English" },
	{ value: "th", label: "Thai" },
] as const;

function getTransitionTaskKey(
	taskName: "transcribe" | "translate",
	key: string,
) {
	return `transition:${taskName}:${key}`;
}

function extractSelectedClipSamples({
	samples,
	sampleRate,
	element,
	assetDurationSeconds,
}: {
	samples: Float32Array;
	sampleRate: number;
	element: AudioElement | VideoElement;
	assetDurationSeconds?: number;
}) {
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

function getDecodedAudioCacheKey(mediaAsset: MediaAsset) {
	return [
		mediaAsset.id,
		mediaAsset.file.name,
		mediaAsset.file.size,
		mediaAsset.file.lastModified,
		DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	].join(":");
}

async function getDecodedAudio(mediaAsset: MediaAsset) {
	const cacheKey = getDecodedAudioCacheKey(mediaAsset);
	const cached = decodedAudioCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const nextPromise = decodeAudioToFloat32({
		audioBlob: mediaAsset.file,
		sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	}).catch((error) => {
		decodedAudioCache.delete(cacheKey);
		throw error;
	});
	decodedAudioCache.set(cacheKey, nextPromise);
	return nextPromise;
}

function parseSrtTimestamp(value: string) {
	const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
	if (!match) {
		return null;
	}

	const [, hours, minutes, seconds, milliseconds] = match;
	return (
		Number(hours) * 3600 +
		Number(minutes) * 60 +
		Number(seconds) +
		Number(milliseconds) / 1000
	);
}

function parseSrtBlocks(content: string) {
	return content
		.replace(/\r\n/g, "\n")
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => {
			const lines = block
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);

			if (lines.length < 2) {
				return null;
			}

			const timestampLineIndex = lines[0]?.includes("-->") ? 0 : 1;
			const timestampLine = lines[timestampLineIndex];
			if (!timestampLine?.includes("-->")) {
				return null;
			}

			const [startRaw, endRaw] = timestampLine.split("-->");
			const startSeconds = parseSrtTimestamp(startRaw ?? "");
			const endSeconds = parseSrtTimestamp(endRaw ?? "");
			if (
				startSeconds === null ||
				endSeconds === null ||
				endSeconds <= startSeconds
			) {
				return null;
			}

			const text = lines
				.slice(timestampLineIndex + 1)
				.join(" ")
				.trim();
			if (!text) {
				return null;
			}

			return {
				startSeconds,
				endSeconds,
				text,
			};
		})
		.filter((block): block is NonNullable<typeof block> => block !== null);
}

export function TransitionTab({
	element,
	mediaAsset,
	trackId,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
	trackId: string;
}) {
	const setTransitionTranscript = useTimelineStore(
		(state) => state.setTransitionTranscript,
	);
	const transitionTranscriptRows = useTimelineStore(
		(state) => state.transitionTranscriptRows,
	);
	const transitionTranscriptSourceLabel = useTimelineStore(
		(state) => state.transitionTranscriptSourceLabel,
	);
	const storedActingEngine = useTimelineStore(
		(state) => state.transitionTranscriptEngineLabel,
	);
	const setAssetsTab = useAssetsPanelStore((state) => state.setActiveTab);
	const voiceModelOptions = useVoiceModelOptions();
	const [selectedLanguage, setSelectedLanguage] = useState<
		(typeof TRANSITION_LANGUAGES)[number]["value"]
	>(TRANSITION_LANGUAGES[0].value);
	const [selectedVoiceModel, setSelectedVoiceModel] = useState(
		voiceModelOptions[0] ?? "Female.pth",
	);
	const [selectedActingEngine, setSelectedActingEngine] = useState(
		normalizeTransitionActingEngine(storedActingEngine),
	);
	const srtInputRef = useRef<HTMLInputElement>(null);
	useSyncTransitionCaptions();
	const taskScopeKey = `${trackId}:${element.id}`;
	const transcribeTaskKey = getTransitionTaskKey("transcribe", taskScopeKey);
	const translateTaskKey = getTransitionTaskKey("translate", taskScopeKey);
	const transcribeTask = useBackgroundTasksStore(
		(state) => state.tasksByKey[transcribeTaskKey] ?? null,
	);
	const translateTask = useBackgroundTasksStore(
		(state) => state.tasksByKey[translateTaskKey] ?? null,
	);
	const startTask = useBackgroundTasksStore((state) => state.startTask);
	const updateTask = useBackgroundTasksStore((state) => state.updateTask);
	const completeTask = useBackgroundTasksStore((state) => state.completeTask);
	const failTask = useBackgroundTasksStore((state) => state.failTask);

	const selectedClipLabel = mediaAsset?.name ?? element.name;
	const canShowTransitionTab =
		element.type === "audio" ||
		(element.type === "video" && mediaAsset?.hasAudio !== false);
	const isTranscribing = transcribeTask?.status === "running";
	const isTranslating = translateTask?.status === "running";
	const transcriptionStep = transcribeTask?.message ?? "";
	const translationStep = translateTask?.message ?? "";

	const applyVoiceModelToRows = (voiceModel: string) => {
		if (transitionTranscriptRows.length === 0) {
			return;
		}

		setTransitionTranscript({
			rows: transitionTranscriptRows.map((row) => ({
				...row,
				voiceModel,
			})),
			sourceLabel: transitionTranscriptSourceLabel,
			engineLabel: selectedActingEngine,
		});
	};

	useEffect(() => {
		if (
			voiceModelOptions.length > 0 &&
			!voiceModelOptions.includes(selectedVoiceModel)
		) {
			setSelectedVoiceModel(voiceModelOptions[0] ?? "Female.pth");
		}
	}, [selectedVoiceModel, voiceModelOptions]);

	useEffect(() => {
		const normalizedEngine =
			normalizeTransitionActingEngine(storedActingEngine);
		if (normalizedEngine !== selectedActingEngine) {
			setSelectedActingEngine(normalizedEngine);
		}
	}, [selectedActingEngine, storedActingEngine]);

	useEffect(() => {
		if (transitionTranscriptRows.length === 0) {
			return;
		}
		if (storedActingEngine === selectedActingEngine) {
			return;
		}
		setTransitionTranscript({
			rows: transitionTranscriptRows,
			sourceLabel: transitionTranscriptSourceLabel,
			engineLabel: selectedActingEngine,
		});
	}, [
		selectedActingEngine,
		setTransitionTranscript,
		storedActingEngine,
		transitionTranscriptRows,
		transitionTranscriptSourceLabel,
	]);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			updateTask(transcribeTaskKey, {
				message: `Loading local transcription ${Math.round(progress.progress)}%`,
			});
			return;
		}

		if (progress.status === "transcribing") {
			updateTask(transcribeTaskKey, {
				message: "Transcribing clip audio...",
			});
		}
	};

	const handleTranscribe = async () => {
		if (!mediaAsset?.file) {
			toast.error("No media file available for transcription");
			return;
		}

		try {
			startTask({
				key: transcribeTaskKey,
				title: "Transcript",
				tabId: "transition",
				elementId: element.id,
				trackId,
				assetId: mediaAsset.id,
				message: "Loading selected source...",
				detail: selectedClipLabel,
				progress: null,
			});

			updateTask(transcribeTaskKey, {
				message: "Decoding selected source...",
			});
			const { samples, sampleRate } = await getDecodedAudio(mediaAsset);
			updateTask(transcribeTaskKey, {
				message: "Extracting selected clip...",
			});
			const selectedClipSamples = extractSelectedClipSamples({
				samples,
				sampleRate,
				element,
				assetDurationSeconds: mediaAsset.duration,
			});
			if (selectedClipSamples.length === 0) {
				toast.error("The selected clip has no usable audio range");
				return;
			}

			const result = await transcriptionService.transcribe({
				audioData: selectedClipSamples,
				language: "auto" as TranscriptionLanguage,
				onProgress: handleProgress,
			});

			updateTask(transcribeTaskKey, {
				message: "Building transcript rows...",
			});
			const transcriptSegments = result.segments.filter(
				(segment) =>
					segment.text.trim().length > 0 && segment.end > segment.start,
			);
			if (transcriptSegments.length === 0) {
				toast.error("No speech detected in this clip");
				return;
			}
			const rows = transcriptSegments.map((segment, index) => ({
				id: `${trackId}:${element.id}:${index}`,
				startSeconds: segment.start,
				endSeconds: segment.end,
				originalText: segment.text.trim(),
				text: segment.text.trim(),
				style: "Adult",
				emotion: "natural",
				voiceModel: selectedVoiceModel,
				speedPercent: 100,
				pitchSemitones: 0,
				echoPercent: 0,
				volumeDb: 0,
				audioLabel: mediaAsset.name ?? element.name,
			}));

			setTransitionTranscript({
				rows,
				sourceLabel: mediaAsset.name ?? element.name,
				engineLabel: selectedActingEngine,
			});
			completeTask(transcribeTaskKey, {
				message: "Transcript ready",
				detail: `${rows.length} row(s) loaded.`,
			});
			toast.success(
				`Transcript rows loaded in original language${result.language ? ` (${result.language})` : ""}.`,
			);
		} catch (caughtError) {
			console.error("Transition transcription failed:", caughtError);
			failTask(
				transcribeTaskKey,
				"Transcript failed",
				caughtError instanceof Error
					? caughtError.message
					: "Failed to transcribe selected clip",
			);
			toast.error(
				caughtError instanceof Error
					? caughtError.message
					: "Failed to transcribe selected clip",
			);
		}
	};

	const handleTranslate = async () => {
		if (transitionTranscriptRows.length === 0) {
			toast.error("Create the transcript first before translating.");
			return;
		}

		try {
			startTask({
				key: translateTaskKey,
				title: "Translate",
				tabId: "transition",
				elementId: element.id,
				trackId,
				assetId: mediaAsset?.id,
				message: "Translating transcript rows...",
				detail: selectedClipLabel,
				progress: null,
			});

			const response = await fetch("/api/translate/quick", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					texts: transitionTranscriptRows.map(
						(row) => row.originalText || row.text,
					),
					targetLanguage: selectedLanguage,
				}),
			});

			const responseText = await response.text();
			let payload:
				| {
						error?: string;
						texts?: string[];
						identity?: boolean;
				  }
				| undefined;
			let errorMessage = responseText || "Failed to translate transcript rows.";

			try {
				payload = JSON.parse(responseText) as typeof payload;
				errorMessage = payload?.error || errorMessage;
			} catch {
				payload = undefined;
			}

			if (!response.ok || !payload.texts) {
				throw new Error(errorMessage);
			}

			setTransitionTranscript({
				rows: transitionTranscriptRows.map((row, index) => ({
					...row,
					text: payload.texts?.[index] ?? row.text,
					voiceModel: selectedVoiceModel,
				})),
				sourceLabel: mediaAsset?.name ?? element.name,
				engineLabel: selectedActingEngine,
			});
			completeTask(translateTaskKey, {
				message: payload.identity
					? "Translation skipped"
					: "Translation completed",
				detail: payload.identity
					? "Transcript already matched the selected language."
					: `Translated ${transitionTranscriptRows.length} row(s).`,
			});

			toast.success(
				payload.identity
					? "Transcript is already in the selected language."
					: "Transcript translated.",
			);
		} catch (caughtError) {
			console.error("Transition translation failed:", caughtError);
			failTask(
				translateTaskKey,
				"Translation failed",
				caughtError instanceof Error
					? caughtError.message
					: "Failed to translate transcript rows",
			);
			toast.error(
				caughtError instanceof Error
					? caughtError.message
					: "Failed to translate transcript rows",
			);
		}
	};

	const handleImportSrt = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";

		if (!file) {
			return;
		}

		try {
			const content = await file.text();
			const segments = parseSrtBlocks(content);
			if (segments.length === 0) {
				toast.error("This SRT file has no valid subtitle rows.");
				return;
			}

			const rows = segments.map((segment, index) => ({
				id: `${trackId}:${element.id}:srt:${index}`,
				startSeconds: segment.startSeconds,
				endSeconds: segment.endSeconds,
				originalText: segment.text,
				text: segment.text,
				style: "Adult",
				emotion: "natural",
				voiceModel: selectedVoiceModel,
				speedPercent: 100,
				pitchSemitones: 0,
				echoPercent: 0,
				volumeDb: 0,
				audioLabel: mediaAsset?.name ?? file.name,
			}));

			setTransitionTranscript({
				rows,
				sourceLabel: file.name,
				engineLabel: selectedActingEngine,
			});
			toast.success("SRT rows loaded into the transition table.");
		} catch (caughtError) {
			console.error("SRT import failed:", caughtError);
			toast.error(
				caughtError instanceof Error
					? caughtError.message
					: "Failed to import SRT file.",
			);
		}
	};

	if (!canShowTransitionTab) {
		return <div className="h-full" />;
	}

	return (
		<div className="space-y-4 p-4">
			<div className="rounded-2xl border bg-background p-4 shadow-sm">
				<div className="flex flex-col gap-4">
					<div className="flex items-start gap-3">
						<div className="rounded-xl bg-primary/10 p-2 text-primary">
							<Sparkles className="size-4" />
						</div>
						<div className="min-w-0">
							<div className="text-sm font-semibold">Vibe Workspace</div>
							<div className="mt-1 text-sm text-muted-foreground">
								Choose the acting engine first, then transcribe or import `.srt`
								rows. Translation stays inside GSMEDIACUT and timeline voice
								render uses the local Python/RVC path, not RunPod.
							</div>
						</div>
					</div>

					<div className="rounded-xl border bg-accent/10 px-4 py-3">
						<div className="text-sm font-semibold">Selected clip</div>
						<div className="mt-1 text-sm text-muted-foreground">
							{selectedClipLabel}
						</div>
					</div>

					<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<div className="space-y-2 rounded-xl border bg-accent/5 p-3">
							<div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
								<div className="text-sm font-semibold">Translate to</div>
								<Select
									value={selectedLanguage}
									onValueChange={(value) =>
										setSelectedLanguage(
											value as (typeof TRANSITION_LANGUAGES)[number]["value"],
										)
									}
								>
									<SelectTrigger className="h-10">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TRANSITION_LANGUAGES.map((language) => (
											<SelectItem key={language.value} value={language.value}>
												{language.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
								<div className="text-sm font-semibold">Acting engine</div>
								<Select
									value={selectedActingEngine}
									onValueChange={(value) =>
										setSelectedActingEngine(
											normalizeTransitionActingEngine(value),
										)
									}
								>
									<SelectTrigger className="h-10">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TRANSITION_ACTING_ENGINES.map((engine) => (
											<SelectItem key={engine} value={engine}>
												{engine}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
								<div className="text-sm font-semibold">Voice model</div>
								<Select
									value={selectedVoiceModel}
									onValueChange={(value) => {
										setSelectedVoiceModel(value);
										applyVoiceModelToRows(value);
									}}
								>
									<SelectTrigger className="h-10">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{voiceModelOptions.map((voiceModel) => (
											<SelectItem key={voiceModel} value={voiceModel}>
												{voiceModel}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<input
								ref={srtInputRef}
								type="file"
								accept=".srt"
								className="hidden"
								onChange={handleImportSrt}
							/>
							<Button
								size="sm"
								variant="secondary"
								className="h-12 w-full rounded-xl px-4"
								onClick={() => setAssetsTab("transcription")}
							>
								Open Vibe UI
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-12 w-full rounded-xl px-4"
								onClick={() => srtInputRef.current?.click()}
							>
								Import SRT
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-12 w-full rounded-xl px-4"
								onClick={handleTranscribe}
								disabled={isTranscribing}
							>
								{isTranscribing
									? transcriptionStep || "Transcribing..."
									: "Transcript"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-12 w-full rounded-xl px-4"
								onClick={handleTranslate}
								disabled={
									isTranslating || transitionTranscriptRows.length === 0
								}
							>
								{isTranslating
									? translationStep || "Translating..."
									: "Translate"}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
