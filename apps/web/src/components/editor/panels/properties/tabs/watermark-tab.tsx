"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/hooks/use-editor";
import {
	usePropertiesStore,
	type WatermarkRegionSelectionRegion,
} from "@/components/editor/panels/properties/stores/properties-store";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/lib/commands";
import { processMediaAssets } from "@/lib/media/processing";
import type { MediaAsset } from "@/lib/media/types";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import {
	useWatermarkJobsStore,
	type WatermarkJobPhase,
} from "@/stores/watermark-jobs-store";
import type { VideoElement } from "@/lib/timeline";

type PresetKey = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type WatermarkEngine = "fast" | "ai";
type EngineAvailability = {
	fast: { available: boolean };
	ai: {
		available: boolean;
		remote?: boolean;
		transport?: "r2" | "server-url" | "inline";
	};
};

type FastRegion = WatermarkRegionSelectionRegion & {
	id: string;
};

const PRESETS: Array<{ id: PresetKey; label: string }> = [
	{ id: "top-left", label: "Top left" },
	{ id: "top-right", label: "Top right" },
	{ id: "bottom-left", label: "Bottom left" },
	{ id: "bottom-right", label: "Bottom right" },
];

function clampToInt(value: number) {
	return Math.max(0, Math.round(value));
}

function parseInput(input: string) {
	const parsed = Number.parseFloat(input);
	return Number.isFinite(parsed) ? clampToInt(parsed) : null;
}

function clampFadeBufferSeconds(value: number) {
	return Math.min(3, Math.max(0, Math.round(value * 10) / 10));
}

function createFastRegion(region: WatermarkRegionSelectionRegion): FastRegion {
	return {
		id: globalThis.crypto.randomUUID(),
		...region,
	};
}

function buildDefaultRegion({
	width,
	height,
	preset,
}: {
	width: number;
	height: number;
	preset: PresetKey;
}) {
	const regionWidth = clampToInt(width * 0.22);
	const regionHeight = clampToInt(height * 0.14);
	const paddingX = clampToInt(width * 0.03);
	const paddingY = clampToInt(height * 0.03);

	switch (preset) {
		case "top-right":
			return {
				x: Math.max(0, width - regionWidth - paddingX),
				y: paddingY,
				width: regionWidth,
				height: regionHeight,
			};
		case "bottom-left":
			return {
				x: paddingX,
				y: Math.max(0, height - regionHeight - paddingY),
				width: regionWidth,
				height: regionHeight,
			};
		case "bottom-right":
			return {
				x: Math.max(0, width - regionWidth - paddingX),
				y: Math.max(0, height - regionHeight - paddingY),
				width: regionWidth,
				height: regionHeight,
			};
		default:
			return {
				x: paddingX,
				y: paddingY,
				width: regionWidth,
				height: regionHeight,
			};
	}
}

export function WatermarkTab({
	element,
	mediaAsset,
	trackId,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
	trackId: string;
}) {
	const editor = useEditor();
	const watermarkRegionSelection = usePropertiesStore(
		(s) => s.watermarkRegionSelection,
	);
	const startWatermarkRegionSelection = usePropertiesStore(
		(s) => s.startWatermarkRegionSelection,
	);
	const cancelWatermarkRegionSelection = usePropertiesStore(
		(s) => s.cancelWatermarkRegionSelection,
	);
	const activeProject = useEditor((e) => e.project.getActive());
	const activeScene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const [engine, setEngine] = useState<WatermarkEngine>("fast");
	const [preset, setPreset] = useState<PresetKey>("top-left");
	const [fastRegions, setFastRegions] = useState<FastRegion[]>([]);
	const [selectedFastRegionId, setSelectedFastRegionId] = useState<
		string | null
	>(null);
	const [aiRegions, setAiRegions] = useState<FastRegion[]>([]);
	const [selectedAiRegionId, setSelectedAiRegionId] = useState<string | null>(
		null,
	);
	const [detectionSkip, setDetectionSkip] = useState("8");
	const [fadeIn, setFadeIn] = useState("0.0");
	const [fadeOut, setFadeOut] = useState("0.0");
	const [aiSoloMode, setAiSoloMode] = useState<"solo" | "squad">("solo");
	const [overwriteOutput, setOverwriteOutput] = useState(false);
	const [transparentOutput, setTransparentOutput] = useState(false);
	const [engineAvailability, setEngineAvailability] =
		useState<EngineAvailability | null>(null);
	const detectionPrompt = "watermark";

	const sourceWidth = mediaAsset?.width ?? 0;
	const sourceHeight = mediaAsset?.height ?? 0;
	const hasProcessableAsset = Boolean(
		mediaAsset?.file && sourceWidth > 0 && sourceHeight > 0,
	);
	const currentAssetId = mediaAsset?.id ?? null;
	const jobsByAssetId = useWatermarkJobsStore((state) => state.jobsByAssetId);
	const currentWatermarkJob = useMemo(
		() => (currentAssetId ? (jobsByAssetId[currentAssetId] ?? null) : null),
		[currentAssetId, jobsByAssetId],
	);
	const startWatermarkJob = useWatermarkJobsStore((state) => state.startJob);
	const updateWatermarkJob = useWatermarkJobsStore((state) => state.updateJob);
	const completeWatermarkJob = useWatermarkJobsStore(
		(state) => state.completeJob,
	);
	const failWatermarkJob = useWatermarkJobsStore((state) => state.failJob);
	const openWatermarkPopup = useWatermarkJobsStore((state) => state.openPopup);
	const isProcessing = currentWatermarkJob?.status === "running";
	const progressPercent = currentWatermarkJob?.progress ?? 0;
	const processingPhase: WatermarkJobPhase =
		currentWatermarkJob?.phase ?? "idle";
	const activeJobEngine = currentWatermarkJob?.engine ?? engine;
	const livePhaseLabel = currentWatermarkJob?.message ?? null;
	const livePhaseDescription = currentWatermarkJob?.detail ?? null;
	const lastOutputName =
		currentWatermarkJob?.status === "completed"
			? (currentWatermarkJob.outputName ?? null)
			: null;

	useEffect(() => {
		if (!hasProcessableAsset) {
			return;
		}

		const defaults = buildDefaultRegion({
			width: sourceWidth,
			height: sourceHeight,
			preset,
		});
		const initialRegion = createFastRegion(defaults);
		setFastRegions([initialRegion]);
		setSelectedFastRegionId(initialRegion.id);
		const initialAiRegion = createFastRegion(defaults);
		setAiRegions([initialAiRegion]);
		setSelectedAiRegionId(initialAiRegion.id);
	}, [hasProcessableAsset, preset, sourceHeight, sourceWidth]);

	useEffect(() => {
		let cancelled = false;

		void fetch("/api/watermark/run", { method: "GET" })
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Failed to load watermark engine status");
				}
				return response.json();
			})
			.then((data) => {
				if (cancelled) {
					return;
				}
				setEngineAvailability(data.engines as EngineAvailability);
			})
			.catch(() => {
				if (!cancelled) {
					setEngineAvailability(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const selectedFastRegion = useMemo(() => {
		const directMatch = fastRegions.find(
			(region) => region.id === selectedFastRegionId,
		);
		return directMatch ?? fastRegions[0] ?? null;
	}, [fastRegions, selectedFastRegionId]);

	const selectedAiRegion = useMemo(() => {
		const directMatch = aiRegions.find(
			(region) => region.id === selectedAiRegionId,
		);
		return directMatch ?? aiRegions[0] ?? null;
	}, [aiRegions, selectedAiRegionId]);

	const regionSummary = useMemo(() => {
		if (!selectedFastRegion) {
			return null;
		}

		return {
			x: Math.min(
				clampToInt(selectedFastRegion.x),
				Math.max(0, sourceWidth - 1),
			),
			y: Math.min(
				clampToInt(selectedFastRegion.y),
				Math.max(0, sourceHeight - 1),
			),
			width: Math.min(clampToInt(selectedFastRegion.width), sourceWidth),
			height: Math.min(clampToInt(selectedFastRegion.height), sourceHeight),
		};
	}, [selectedFastRegion, sourceHeight, sourceWidth]);

	const aiRegionSummary = useMemo(() => {
		if (!selectedAiRegion) {
			return null;
		}

		return {
			x: Math.min(clampToInt(selectedAiRegion.x), Math.max(0, sourceWidth - 1)),
			y: Math.min(
				clampToInt(selectedAiRegion.y),
				Math.max(0, sourceHeight - 1),
			),
			width: Math.min(clampToInt(selectedAiRegion.width), sourceWidth),
			height: Math.min(clampToInt(selectedAiRegion.height), sourceHeight),
		};
	}, [selectedAiRegion, sourceHeight, sourceWidth]);

	const hasValidFastRegions = useMemo(
		() =>
			fastRegions.some(
				(region) =>
					region.width > 0 &&
					region.height > 0 &&
					sourceWidth > 0 &&
					sourceHeight > 0,
			),
		[fastRegions, sourceHeight, sourceWidth],
	);

	const hasValidAiRegions = useMemo(
		() =>
			aiRegions.some(
				(region) =>
					region.width > 0 &&
					region.height > 0 &&
					sourceWidth > 0 &&
					sourceHeight > 0,
			),
		[aiRegions, sourceHeight, sourceWidth],
	);

	useEffect(() => {
		const targetMatches =
			watermarkRegionSelection.trackId === trackId &&
			watermarkRegionSelection.elementId === element.id;
		if (!targetMatches || !watermarkRegionSelection.region) {
			return;
		}

		const nextRegion = watermarkRegionSelection.region;
		const nextIndex = watermarkRegionSelection.regionIndex ?? 0;
		if (engine === "ai") {
			setAiRegions((currentRegions) =>
				currentRegions.map((region, index) =>
					index === nextIndex
						? {
								...region,
								x: nextRegion.x,
								y: nextRegion.y,
								width: nextRegion.width,
								height: nextRegion.height,
							}
						: region,
				),
			);
			return;
		}

		setFastRegions((currentRegions) =>
			currentRegions.map((region, index) =>
				index === nextIndex
					? {
							...region,
							x: nextRegion.x,
							y: nextRegion.y,
							width: nextRegion.width,
							height: nextRegion.height,
						}
					: region,
			),
		);
	}, [element.id, engine, trackId, watermarkRegionSelection]);

	const isSelectingRegionOnPreview =
		watermarkRegionSelection.active &&
		watermarkRegionSelection.trackId === trackId &&
		watermarkRegionSelection.elementId === element.id;

	const selectedFastRegionIndex = useMemo(
		() =>
			selectedFastRegion
				? fastRegions.findIndex((region) => region.id === selectedFastRegion.id)
				: -1,
		[fastRegions, selectedFastRegion],
	);

	const selectedAiRegionIndex = useMemo(
		() =>
			selectedAiRegion
				? aiRegions.findIndex((region) => region.id === selectedAiRegion.id)
				: -1,
		[aiRegions, selectedAiRegion],
	);

	const updateSelectedFastRegion = (
		field: keyof WatermarkRegionSelectionRegion,
		value: string,
	) => {
		if (!selectedFastRegion) {
			return;
		}

		const parsedValue = parseInput(value);
		if (parsedValue === null) {
			return;
		}

		setFastRegions((currentRegions) =>
			currentRegions.map((region) =>
				region.id === selectedFastRegion.id
					? {
							...region,
							[field]: parsedValue,
						}
					: region,
			),
		);
	};

	const updateSelectedAiRegion = (
		field: keyof WatermarkRegionSelectionRegion,
		value: string,
	) => {
		if (!selectedAiRegion) {
			return;
		}

		const parsedValue = parseInput(value);
		if (parsedValue === null) {
			return;
		}

		setAiRegions((currentRegions) =>
			currentRegions.map((region) =>
				region.id === selectedAiRegion.id
					? {
							...region,
							[field]: parsedValue,
						}
					: region,
			),
		);
	};

	const handleAddRegion = () => {
		if (!hasProcessableAsset) {
			return;
		}

		const nextRegion = createFastRegion(
			buildDefaultRegion({
				width: sourceWidth,
				height: sourceHeight,
				preset,
			}),
		);
		if (engine === "ai") {
			setAiRegions((currentRegions) => [...currentRegions, nextRegion]);
			setSelectedAiRegionId(nextRegion.id);
			return;
		}

		setFastRegions((currentRegions) => [...currentRegions, nextRegion]);
		setSelectedFastRegionId(nextRegion.id);
	};

	const handleRemoveRegion = (regionId: string) => {
		if (engine === "ai") {
			setAiRegions((currentRegions) => {
				const remaining = currentRegions.filter(
					(region) => region.id !== regionId,
				);
				if (remaining.length === 0) {
					return currentRegions;
				}
				if (selectedAiRegionId === regionId) {
					setSelectedAiRegionId(remaining[0]?.id ?? null);
				}
				return remaining;
			});
			return;
		}

		setFastRegions((currentRegions) => {
			const remaining = currentRegions.filter(
				(region) => region.id !== regionId,
			);
			if (remaining.length === 0) {
				return currentRegions;
			}
			if (selectedFastRegionId === regionId) {
				setSelectedFastRegionId(remaining[0]?.id ?? null);
			}
			return remaining;
		});
	};

	const handleSelectRegionOnPreview = () => {
		if (!hasProcessableAsset) {
			toast.error("No source video available");
			return;
		}

		if (isSelectingRegionOnPreview) {
			cancelWatermarkRegionSelection();
			return;
		}

		const currentRegionSummary =
			engine === "ai" ? aiRegionSummary : regionSummary;
		const currentRegionIndex =
			engine === "ai"
				? Math.max(0, selectedAiRegionIndex)
				: Math.max(0, selectedFastRegionIndex);

		startWatermarkRegionSelection({
			trackId,
			elementId: element.id,
			regionIndex: currentRegionIndex,
			region: currentRegionSummary
				? ({
						x: currentRegionSummary.x,
						y: currentRegionSummary.y,
						width: currentRegionSummary.width,
						height: currentRegionSummary.height,
					} satisfies WatermarkRegionSelectionRegion)
				: null,
		});
		toast.info("Draw on the main preview", {
			description:
				"Drag directly on the real video preview to mark the watermark area.",
		});
	};

	const aiUsesRunpod = engineAvailability?.ai.remote ?? false;
	const aiTransportMode = engineAvailability?.ai.transport ?? "inline";
	const detectionSkipValue = Math.min(
		10,
		Math.max(1, Number.parseInt(detectionSkip, 10) || 1),
	);
	const fadeInValue = Math.max(0, Number.parseFloat(fadeIn) || 0);
	const fadeOutValue = Math.max(0, Number.parseFloat(fadeOut) || 0);
	const updateFadeDraft = (setter: (value: string) => void, value: string) => {
		if (/^\d*(\.\d*)?$/.test(value)) {
			setter(value);
		}
	};
	const commitFadeValue = (setter: (value: string) => void, value: string) => {
		setter(clampFadeBufferSeconds(Number.parseFloat(value) || 0).toFixed(1));
	};
	const nudgeFadeValue = (
		setter: (value: string) => void,
		value: number,
		delta: number,
	) => {
		setter(clampFadeBufferSeconds(value + delta).toFixed(1));
	};

	const insertTrackIndex = useMemo(() => {
		if (!activeScene) {
			return 0;
		}

		const overlayIndex = activeScene.tracks.overlay.findIndex(
			(sceneTrack) => sceneTrack.id === trackId,
		);
		if (overlayIndex >= 0) {
			return overlayIndex;
		}

		if (activeScene.tracks.main.id === trackId) {
			return activeScene.tracks.overlay.length;
		}

		return 0;
	}, [activeScene, trackId]);

	const phaseLabel = useMemo(() => {
		if (livePhaseLabel) {
			return livePhaseLabel;
		}

		switch (processingPhase) {
			case "preparing":
				return "Preparing clip";
			case "uploading":
				if (!aiUsesRunpod) {
					return "Preparing local job";
				}
				if (aiTransportMode === "r2") {
					return "Uploading to R2";
				}
				if (aiTransportMode === "server-url") {
					return "Uploading to server";
				}
				return "Sending clip to Runpod";
			case "queued":
				return "Queued on Runpod";
			case "processing":
				return activeJobEngine === "ai" && aiUsesRunpod
					? "Processing on remote GPU"
					: "Processing locally";
			case "downloading":
				return "Downloading cleaned result";
			case "importing":
				return "Importing cleaned clip";
			case "cleaning":
				return "Cleaning up temporary files";
			default:
				return null;
		}
	}, [
		aiTransportMode,
		aiUsesRunpod,
		livePhaseLabel,
		processingPhase,
		activeJobEngine,
	]);

	const phaseDescription = useMemo(() => {
		if (livePhaseDescription) {
			return livePhaseDescription;
		}

		switch (processingPhase) {
			case "preparing":
				return "Checking the selected clip and building the processing request.";
			case "uploading":
				if (!aiUsesRunpod) {
					return "Starting the local watermark cleanup pipeline.";
				}
				if (aiTransportMode === "r2") {
					return "Sending the source clip to Cloudflare R2 so Runpod can download it.";
				}
				if (aiTransportMode === "server-url") {
					return "Sending the source clip to your server so Runpod can download it.";
				}
				return "Sending the clip directly to Runpod in the request body.";
			case "queued":
				return "Waiting for an available worker to pick up the AI job.";
			case "processing":
				return activeJobEngine === "ai" && aiUsesRunpod
					? "Runpod is detecting and removing the watermark on the GPU."
					: "The local engine is rendering the cleaned clip.";
			case "downloading":
				return "Fetching the cleaned video back into GSMEDIACUT.";
			case "importing":
				return "Adding the cleaned clip to Media and placing it on the timeline.";
			case "cleaning":
				return "Removing temporary cloud or local files after the result is secured.";
			default:
				return null;
		}
	}, [
		aiTransportMode,
		aiUsesRunpod,
		activeJobEngine,
		livePhaseDescription,
		processingPhase,
	]);

	const handleProcess = async () => {
		if (!activeProject || !mediaAsset?.file || !currentAssetId) {
			toast.error("No source video available");
			return;
		}

		if (currentWatermarkJob?.status === "running") {
			openWatermarkPopup();
			toast.info("Watermark cleanup is already running", {
				description: `${mediaAsset.name} is still processing in the background.`,
			});
			return;
		}

		if (
			engine === "fast" &&
			(!hasValidFastRegions ||
				!regionSummary ||
				regionSummary.width <= 0 ||
				regionSummary.height <= 0)
		) {
			toast.error("Enter a valid watermark region");
			return;
		}

		const jobId = globalThis.crypto.randomUUID();
		startWatermarkJob({
			assetId: currentAssetId,
			assetName: mediaAsset.name,
			jobId,
			engine,
			elementId: element.id,
			trackId,
			phase: "preparing",
			progress: 3,
			message: "Preparing clip",
			detail: "Checking the selected clip and building the processing request.",
			outputName: null,
		});
		const progressEvents = new EventSource(
			`/api/watermark/run/events?jobId=${encodeURIComponent(jobId)}`,
		);

		progressEvents.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data) as {
					type?: string;
					progress?: {
						phase?: WatermarkJobPhase;
						progress?: number;
						message?: string;
						detail?: string;
						status?: "running" | "completed" | "failed";
					} | null;
				};

				if (!payload.progress) {
					return;
				}

				updateWatermarkJob(currentAssetId, jobId, {
					progress: payload.progress.progress,
					phase: payload.progress.phase,
					message: payload.progress.message,
					detail: payload.progress.detail,
					status: payload.progress.status,
				});

				if (payload.progress.status && payload.progress.status !== "running") {
					progressEvents.close();
				}
			} catch (error) {
				console.error("Failed to parse watermark progress event", error);
			}
		};

		progressEvents.onerror = () => {
			progressEvents.close();
		};
		try {
			const formData = new FormData();
			formData.append("file", mediaAsset.file, mediaAsset.file.name);
			formData.append("engine", engine);
			if (engine === "fast") {
				const safeRegions = fastRegions
					.map((region) => ({
						x: clampToInt(region.x),
						y: clampToInt(region.y),
						width: clampToInt(region.width),
						height: clampToInt(region.height),
					}))
					.filter((region) => region.width > 0 && region.height > 0);
				const safeRegion = safeRegions[0];
				if (!safeRegion || safeRegions.length === 0) {
					throw new Error("Missing watermark region");
				}
				formData.append("x", safeRegion.x.toString());
				formData.append("y", safeRegion.y.toString());
				formData.append("width", safeRegion.width.toString());
				formData.append("height", safeRegion.height.toString());
				formData.append("regions", JSON.stringify(safeRegions));
			} else if (engine === "ai") {
				const safeRegions = aiRegions
					.map((region) => ({
						x: clampToInt(region.x),
						y: clampToInt(region.y),
						width: clampToInt(region.width),
						height: clampToInt(region.height),
					}))
					.filter((region) => region.width > 0 && region.height > 0);
				if (safeRegions.length > 0) {
					formData.append("regions", JSON.stringify(safeRegions));
				}
				formData.append("detectionPrompt", detectionPrompt);
				formData.append("detectionSkip", aiUsesRunpod ? "10" : detectionSkip);
				formData.append("fadeIn", fadeIn);
				formData.append("fadeOut", fadeOut);
				formData.append("transparent", transparentOutput ? "true" : "false");
			}

			updateWatermarkJob(currentAssetId, jobId, {
				phase: "uploading",
			});
			const response = await fetch("/api/watermark/run", {
				method: "POST",
				headers: {
					"x-gsm-watermark-job-id": jobId,
				},
				body: formData,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Watermark cleanup failed");
			}

			const aiMode = response.headers.get("X-GSM-AI-Mode");
			const aiModeReason = response.headers.get("X-GSM-AI-Reason");
			if (engine === "ai" && aiUsesRunpod) {
				if (
					aiMode === "runpod-r2" ||
					aiMode === "runpod-url" ||
					aiMode === "runpod"
				) {
					updateWatermarkJob(currentAssetId, jobId, {
						phase: "downloading",
					});
				} else if (aiMode === "local-fallback" || aiMode === "local") {
					updateWatermarkJob(currentAssetId, jobId, {
						phase: "processing",
					});
				}
			}

			updateWatermarkJob(currentAssetId, jobId, {
				phase: "downloading",
				message: "Downloading cleaned result",
				detail: "Fetching the cleaned video back into GSMEDIACUT.",
			});
			const blob = await response.blob();
			updateWatermarkJob(currentAssetId, jobId, {
				phase: "importing",
				progress: 96,
				message: "Importing cleaned clip",
				detail:
					"Adding the cleaned clip to Media and placing it on the timeline.",
			});
			const cleanedFile = new File(
				[blob],
				mediaAsset.name.replace(/(\.[^.]+)?$/, "_cleaned.mp4"),
				{ type: "video/mp4", lastModified: Date.now() },
			);

			const processedAssets = await processMediaAssets({
				files: [cleanedFile],
			});
			const processedAsset = processedAssets[0];
			if (!processedAsset) {
				throw new Error("Failed to import cleaned clip");
			}

			const createdAsset = await editor.media.addMediaAsset({
				projectId: activeProject.metadata.id,
				asset: processedAsset,
			});

			if (!createdAsset) {
				throw new Error("Failed to save cleaned clip");
			}

			const cleanedElement = buildElementFromMedia({
				mediaId: createdAsset.id,
				mediaType: createdAsset.type,
				name: createdAsset.name,
				duration: createdAsset.duration ?? element.duration,
				startTime: element.startTime,
			});

			if (overwriteOutput) {
				editor.timeline.updateElements({
					updates: [
						{
							trackId,
							elementId: element.id,
							patch: {
								mediaId: createdAsset.id,
								name: createdAsset.name,
								duration: createdAsset.duration ?? element.duration,
								sourceDuration: createdAsset.duration ?? element.duration,
								hidden: false,
								muted: false,
							},
						},
					],
				});
				editor.selection.setSelectedElements({
					elements: [{ trackId, elementId: element.id }],
				});
			} else {
				const addTrackCommand = new AddTrackCommand("video", insertTrackIndex);
				const insertTrackId = addTrackCommand.getTrackId();
				const insertElementCommand = new InsertElementCommand({
					element: cleanedElement,
					placement: { mode: "explicit", trackId: insertTrackId },
				});
				editor.command.execute({
					command: new BatchCommand([addTrackCommand, insertElementCommand]),
				});
				const insertedElement = editor.timeline
					.getTrackById({ trackId: insertTrackId })
					?.elements.find(
						(trackElement) =>
							trackElement.type === "video" &&
							"mediaId" in trackElement &&
							trackElement.mediaId === createdAsset.id,
					);
				if (insertedElement) {
					editor.timeline.updateElements({
						updates: [
							{
								trackId,
								elementId: element.id,
								patch: {
									hidden: true,
									muted: true,
								},
							},
						],
					});
					editor.selection.setSelectedElements({
						elements: [
							{ trackId: insertTrackId, elementId: insertedElement.id },
						],
					});
				}
			}
			completeWatermarkJob(currentAssetId, jobId, {
				outputName: createdAsset.name,
				message: "Watermark cleanup completed",
				detail: overwriteOutput
					? "The selected clip was replaced with the cleaned result."
					: "A cleaned clip was added above the original on the timeline.",
			});

			toast.success("Watermark cleanup finished", {
				description: overwriteOutput
					? "The selected clip was replaced with the cleaned result."
					: "A cleaned clip was added above the original. The original clip was hidden and muted so the result is visible immediately.",
			});
			if (engine === "ai" && aiMode === "local-fallback" && aiModeReason) {
				toast.info("AI fell back to local processing", {
					description: aiModeReason,
				});
			}
		} catch (error) {
			console.error(error);
			failWatermarkJob(
				currentAssetId,
				jobId,
				"Watermark cleanup failed",
				error instanceof Error ? error.message : "Unknown error",
			);
			toast.error("Watermark cleanup failed", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			progressEvents.close();
		}
	};

	return (
		<Section collapsible sectionKey={`${element.id}:watermark`}>
			<SectionHeader>
				<SectionTitle>Watermark</SectionTitle>
			</SectionHeader>
			<SectionContent className="space-y-4">
				<div className="rounded-lg border bg-accent/20 p-3">
					<div className="text-sm font-medium">Watermark removal</div>
					<div className="text-muted-foreground mt-1 text-sm">
						Run cleanup on the selected clip, then place the cleaned result on a
						new track above the original for instant comparison.
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => setEngine("fast")}
						className={`rounded-lg border px-3 py-3 text-left transition ${
							engine === "fast"
								? "border-primary bg-primary/10"
								: "hover:bg-accent/40"
						}`}
					>
						<div className="text-sm font-medium">Fast</div>
						<div className="text-muted-foreground mt-1 text-xs">
							FFmpeg delogo. Best for fixed corner logos.
						</div>
					</button>
					<button
						type="button"
						onClick={() => setEngine("ai")}
						className={`rounded-lg border px-3 py-3 text-left transition ${
							engine === "ai"
								? "border-primary bg-primary/10"
								: "hover:bg-accent/40"
						}`}
					>
						<div className="text-sm font-medium">AI</div>
						<div className="text-muted-foreground mt-1 text-xs">
							WatermarkRemover-AI. Slower but better on complex backgrounds.
						</div>
					</button>
				</div>

				{engine === "ai" ? (
					<div className="space-y-4 rounded-2xl border bg-card p-3 text-card-foreground shadow-sm">
						<div className="rounded-xl border bg-background p-3">
							<div className="text-sm font-semibold">
								{mediaAsset?.name ?? "No source clip"}
							</div>
							<div className="text-muted-foreground mt-1 text-xs">
								{hasProcessableAsset
									? `${sourceWidth} x ${sourceHeight}`
									: "Select a real video element with a loaded media asset."}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<button
								type="button"
								onClick={() => {
									setAiSoloMode("solo");
									setOverwriteOutput(false);
								}}
								className={`rounded-xl border px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] transition ${
									aiSoloMode === "solo"
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
							>
								Solo
							</button>
							<button
								type="button"
								onClick={() => {
									setAiSoloMode("squad");
									setOverwriteOutput(true);
								}}
								className={`rounded-xl border px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] transition ${
									aiSoloMode === "squad"
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
							>
								Squad
							</button>
						</div>

						<div className="space-y-2 rounded-xl border bg-background p-3">
							<div className="flex items-center justify-between gap-4">
								<div>
									<div className="text-sm font-semibold">Gaslight Files</div>
									<div className="text-muted-foreground text-xs">
										Replace the selected clip instead of stacking a cleaned copy
									</div>
								</div>
								<Switch
									checked={overwriteOutput}
									onCheckedChange={(checked) => {
										setOverwriteOutput(checked);
										setAiSoloMode(checked ? "squad" : "solo");
									}}
								/>
							</div>
						</div>

						<div className="space-y-2 rounded-xl border bg-background p-3">
							<div className="flex items-center justify-between gap-4">
								<div>
									<div className="text-sm font-semibold">Ghost Mode 👻</div>
									<div className="text-muted-foreground text-xs">
										Use WatermarkRemover-AI transparent mode
									</div>
								</div>
								<Switch
									checked={transparentOutput}
									onCheckedChange={setTransparentOutput}
								/>
							</div>
						</div>

						<div className="space-y-2 px-1">
							<div className="flex items-center justify-between text-[13px] font-semibold">
								<span>Sigma Detect</span>
								<span>{Math.round((11 - detectionSkipValue) * 10)}%</span>
							</div>
							<Slider
								value={[detectionSkipValue]}
								min={1}
								max={10}
								step={1}
								onValueChange={(values) =>
									setDetectionSkip(String(values[0] ?? detectionSkipValue))
								}
								className="[&_[data-slot='slider-range']]:bg-primary [&_[data-slot='slider-thumb']]:border-primary"
							/>
						</div>

						<div className="space-y-2">
							<div className="rounded-xl border bg-background p-4">
								<div className="mb-3 flex items-center justify-between gap-3">
									<div className="text-sm font-semibold">Manual Areas</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleAddRegion}
									>
										Add Region
									</Button>
								</div>
								<div className="space-y-3">
									<div className="rounded-xl border bg-accent/30 p-3">
										<div className="text-muted-foreground mb-3 text-xs">
											Draw directly on the real video preview on the left.
											Manual areas override AI detection when needed.
										</div>
										<Button
											type="button"
											variant={
												isSelectingRegionOnPreview ? "secondary" : "outline"
											}
											onClick={handleSelectRegionOnPreview}
											className="w-full"
										>
											{isSelectingRegionOnPreview
												? "Cancel Preview Selection"
												: "Select On Preview"}
										</Button>
									</div>

									<div className="space-y-2">
										{aiRegions.map((region, index) => {
											const isSelected = region.id === selectedAiRegion?.id;
											return (
												<div
													key={region.id}
													className="flex items-center gap-2"
												>
													<button
														type="button"
														onClick={() => setSelectedAiRegionId(region.id)}
														className={`flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
															isSelected
																? "border-primary bg-primary/10 text-foreground"
																: "bg-background text-foreground hover:bg-accent/40"
														}`}
													>
														<span>{`Object ${index + 1}`}</span>
														<span className="text-muted-foreground text-xs">
															{`${region.x}, ${region.y} · ${region.width}x${region.height}`}
														</span>
													</button>
													{aiRegions.length > 1 ? (
														<button
															type="button"
															onClick={() => handleRemoveRegion(region.id)}
															className="text-destructive rounded-md border px-3 py-2 text-xs"
														>
															Remove
														</button>
													) : null}
												</div>
											);
										})}
									</div>

									<div className="grid grid-cols-2 gap-2">
										<NumberField
											icon="X"
											value={selectedAiRegion ? String(selectedAiRegion.x) : ""}
											onChange={(event) =>
												updateSelectedAiRegion("x", event.currentTarget.value)
											}
										/>
										<NumberField
											icon="Y"
											value={selectedAiRegion ? String(selectedAiRegion.y) : ""}
											onChange={(event) =>
												updateSelectedAiRegion("y", event.currentTarget.value)
											}
										/>
										<NumberField
											icon="W"
											value={
												selectedAiRegion ? String(selectedAiRegion.width) : ""
											}
											onChange={(event) =>
												updateSelectedAiRegion(
													"width",
													event.currentTarget.value,
												)
											}
										/>
										<NumberField
											icon="H"
											value={
												selectedAiRegion ? String(selectedAiRegion.height) : ""
											}
											onChange={(event) =>
												updateSelectedAiRegion(
													"height",
													event.currentTarget.value,
												)
											}
										/>
									</div>
								</div>
							</div>
						</div>

						<div className="space-y-4 rounded-xl border bg-background p-4">
							<div className="text-muted-foreground flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]">
								<span>🎚</span>
								<span>Video Settings</span>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3 text-sm">
									<div className="font-medium">Detection Skip</div>
									<div className="text-muted-foreground">
										{detectionSkipValue} frames
									</div>
								</div>
								<Slider
									value={[detectionSkipValue]}
									min={1}
									max={10}
									step={1}
									onValueChange={(values) =>
										setDetectionSkip(String(values[0] ?? detectionSkipValue))
									}
									className="[&_[data-slot='slider-range']]:bg-primary [&_[data-slot='slider-thumb']]:border-primary"
								/>
								<div className="text-muted-foreground text-xs">
									Higher = faster, but may miss short watermarks
								</div>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3 text-sm">
									<div className="font-medium">Fade In Buffer</div>
									<div className="text-muted-foreground">
										{fadeInValue.toFixed(1)}s
									</div>
								</div>
								<NumberField
									icon="IN"
									value={fadeIn}
									suffix="s"
									dragSensitivity="slow"
									scrubClamp={{ min: 0, max: 3 }}
									onChange={(event) =>
										updateFadeDraft(setFadeIn, event.currentTarget.value)
									}
									onBlur={(event) =>
										commitFadeValue(setFadeIn, event.currentTarget.value)
									}
									onScrub={(value) =>
										setFadeIn(clampFadeBufferSeconds(value).toFixed(1))
									}
									onWheel={(event) => {
										event.preventDefault();
										nudgeFadeValue(
											setFadeIn,
											fadeInValue,
											event.deltaY < 0 ? 0.1 : -0.1,
										);
									}}
								/>
								<Slider
									value={[fadeInValue]}
									min={0}
									max={3}
									step={0.1}
									onValueChange={(values) =>
										setFadeIn((values[0] ?? fadeInValue).toFixed(1))
									}
									className="[&_[data-slot='slider-range']]:bg-primary [&_[data-slot='slider-thumb']]:border-primary"
								/>
								<div className="text-muted-foreground text-xs">
									Extend removal backwards for fade-in watermarks
								</div>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3 text-sm">
									<div className="font-medium">Fade Out Buffer</div>
									<div className="text-muted-foreground">
										{fadeOutValue.toFixed(1)}s
									</div>
								</div>
								<NumberField
									icon="OUT"
									value={fadeOut}
									suffix="s"
									dragSensitivity="slow"
									scrubClamp={{ min: 0, max: 3 }}
									onChange={(event) =>
										updateFadeDraft(setFadeOut, event.currentTarget.value)
									}
									onBlur={(event) =>
										commitFadeValue(setFadeOut, event.currentTarget.value)
									}
									onScrub={(value) =>
										setFadeOut(clampFadeBufferSeconds(value).toFixed(1))
									}
									onWheel={(event) => {
										event.preventDefault();
										nudgeFadeValue(
											setFadeOut,
											fadeOutValue,
											event.deltaY < 0 ? 0.1 : -0.1,
										);
									}}
								/>
								<Slider
									value={[fadeOutValue]}
									min={0}
									max={3}
									step={0.1}
									onValueChange={(values) =>
										setFadeOut((values[0] ?? fadeOutValue).toFixed(1))
									}
									className="[&_[data-slot='slider-range']]:bg-primary [&_[data-slot='slider-thumb']]:border-primary"
								/>
								<div className="text-muted-foreground text-xs">
									Extend removal forwards for fade-out watermarks
								</div>
							</div>
						</div>

						<div className="space-y-2">
							<div className="text-muted-foreground px-1 text-[11px] font-semibold uppercase tracking-[0.08em]">
								Output Drip
							</div>
							<Select
								value={overwriteOutput ? "overwrite" : "auto"}
								onValueChange={(value) => {
									const overwrite = value === "overwrite";
									setOverwriteOutput(overwrite);
									setAiSoloMode(overwrite ? "squad" : "solo");
								}}
							>
								<SelectTrigger className="h-12 rounded-xl bg-background">
									<SelectValue placeholder="Auto (Keep Original)" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto (Keep Original)</SelectItem>
									<SelectItem value="overwrite">Overwrite Source</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				) : (
					<SectionFields>
						<SectionField label="Source clip">
							<div className="rounded-md border bg-accent/20 px-3 py-2 text-sm">
								<div className="font-medium">
									{mediaAsset?.name ?? "No source clip"}
								</div>
								<div className="text-muted-foreground mt-1">
									{hasProcessableAsset
										? `${sourceWidth} x ${sourceHeight}`
										: "Select a real video element with a loaded media asset."}
								</div>
							</div>
						</SectionField>

						<SectionField label="Preset">
							<Select
								value={preset}
								onValueChange={(value) => setPreset(value as PresetKey)}
							>
								<SelectTrigger className="bg-transparent">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRESETS.map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>

						<SectionField label="Region">
							<div className="space-y-3">
								<div className="rounded-lg border bg-accent/20 p-3">
									<div className="text-muted-foreground mb-3 text-xs">
										Use the real video preview on the left to draw the watermark
										area directly.
									</div>
									<Button
										type="button"
										variant={
											isSelectingRegionOnPreview ? "secondary" : "outline"
										}
										onClick={handleSelectRegionOnPreview}
										className="w-full"
									>
										{isSelectingRegionOnPreview
											? "Cancel Preview Selection"
											: "Select On Preview"}
									</Button>
								</div>

								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<div className="text-sm font-medium">Areas</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={handleAddRegion}
										>
											Add Region
										</Button>
									</div>
									<div className="space-y-2">
										{fastRegions.map((region, index) => {
											const isSelected = region.id === selectedFastRegion?.id;
											return (
												<div
													key={region.id}
													className="flex items-center gap-2"
												>
													<button
														type="button"
														onClick={() => setSelectedFastRegionId(region.id)}
														className={`flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
															isSelected
																? "border-primary bg-primary/10"
																: "hover:bg-accent/40"
														}`}
													>
														<span>{`Object ${index + 1}`}</span>
														<span className="text-xs text-muted-foreground">
															{`${region.x}, ${region.y} • ${region.width}x${region.height}`}
														</span>
													</button>
													{fastRegions.length > 1 ? (
														<button
															type="button"
															onClick={() => handleRemoveRegion(region.id)}
															className="text-destructive rounded-md border px-2 py-2 text-xs"
														>
															Remove
														</button>
													) : null}
												</div>
											);
										})}
									</div>
								</div>

								<div className="grid grid-cols-2 gap-2">
									<NumberField
										icon="X"
										value={
											selectedFastRegion ? String(selectedFastRegion.x) : ""
										}
										onChange={(event) =>
											updateSelectedFastRegion("x", event.currentTarget.value)
										}
									/>
									<NumberField
										icon="Y"
										value={
											selectedFastRegion ? String(selectedFastRegion.y) : ""
										}
										onChange={(event) =>
											updateSelectedFastRegion("y", event.currentTarget.value)
										}
									/>
									<NumberField
										icon="W"
										value={
											selectedFastRegion ? String(selectedFastRegion.width) : ""
										}
										onChange={(event) =>
											updateSelectedFastRegion(
												"width",
												event.currentTarget.value,
											)
										}
									/>
									<NumberField
										icon="H"
										value={
											selectedFastRegion
												? String(selectedFastRegion.height)
												: ""
										}
										onChange={(event) =>
											updateSelectedFastRegion(
												"height",
												event.currentTarget.value,
											)
										}
									/>
								</div>
							</div>
						</SectionField>
					</SectionFields>
				)}

				{engine === "fast" ? (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						{hasValidFastRegions
							? `FFmpeg delogo regions: ${fastRegions.length} area(s). Selected: x ${regionSummary?.x ?? 0}, y ${regionSummary?.y ?? 0}, width ${regionSummary?.width ?? 0}, height ${regionSummary?.height ?? 0}`
							: "Enter a valid region to enable processing."}
					</div>
				) : (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						AI mode uses the real WatermarkRemover-AI backend. If Runpod
						{aiUsesRunpod
							? " is configured, so this will run remotely on your endpoint."
							: " is not configured yet, so this will fall back to local CPU processing."}{" "}
						{hasValidAiRegions
							? ` ${aiRegions.length} manual area(s) are also selected and will override missed detections.`
							: " Skip controls how often the detector scans frames, while fade in and fade out expand the mask across nearby frames."}
					</div>
				)}

				<div className="rounded-md border px-3 py-2 text-sm">
					<div className="font-medium">
						{isProcessing
							? `Processing clip... ${progressPercent}%`
							: currentWatermarkJob?.status === "failed"
								? "Last watermark job failed"
								: lastOutputName
									? "Last cleaned result"
									: "Ready to run"}
					</div>
					<div className="text-muted-foreground mt-1">
						{isProcessing
							? `${phaseLabel ?? "Processing"} on ${
									mediaAsset?.name ?? "selected clip"
								}.`
							: currentWatermarkJob?.status === "failed"
								? (currentWatermarkJob.detail ??
									"Adjust the region or engine and try again.")
								: lastOutputName
									? `${lastOutputName} was added to Media and selected on the timeline.`
									: "Choose an engine, adjust settings, then click Remove watermark."}
					</div>
					{isProcessing ? (
						<div className="mt-3">
							<div className="h-2 overflow-hidden rounded-full bg-accent">
								<div
									className="bg-primary h-full transition-[width] duration-500 ease-out"
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							<div className="text-muted-foreground mt-2 text-xs">
								{phaseDescription ??
									(engine === "ai" && aiUsesRunpod
										? "Queued and remote GPU processing can take time while the worker starts and renders the cleaned clip."
										: "Processing locally. Time depends on clip length and engine settings.")}
							</div>
						</div>
					) : null}
				</div>

				<Button
					onClick={handleProcess}
					disabled={
						!hasProcessableAsset ||
						(engine === "fast" && !hasValidFastRegions) ||
						isProcessing
					}
					className="w-full"
				>
					{isProcessing ? "Already processing..." : "Remove watermark"}
				</Button>
			</SectionContent>
		</Section>
	);
}
