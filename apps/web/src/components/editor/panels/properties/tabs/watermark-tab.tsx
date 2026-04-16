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
import { useEditor } from "@/hooks/use-editor";
import { processMediaAssets } from "@/lib/media/processing";
import type { MediaAsset } from "@/lib/media/types";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import type { VideoElement } from "@/lib/timeline";

type PresetKey = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type WatermarkEngine = "fast" | "ai" | "veo";
type EngineAvailability = {
	fast: { available: boolean };
	ai: { available: boolean; remote?: boolean };
	veo: { available: boolean; reason?: string | null };
};

type ProcessingPhase =
	| "idle"
	| "preparing"
	| "uploading"
	| "queued"
	| "processing"
	| "downloading"
	| "importing"
	| "cleaning";

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
	const activeProject = useEditor((e) => e.project.getActive());
	const activeScene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const [engine, setEngine] = useState<WatermarkEngine>("fast");
	const [preset, setPreset] = useState<PresetKey>("top-left");
	const [x, setX] = useState("0");
	const [y, setY] = useState("0");
	const [width, setWidth] = useState("0");
	const [height, setHeight] = useState("0");
	const [detectionPrompt, setDetectionPrompt] = useState("watermark");
	const [detectionSkip, setDetectionSkip] = useState("8");
	const [fadeIn, setFadeIn] = useState("0.0");
	const [fadeOut, setFadeOut] = useState("0.0");
	const [isProcessing, setIsProcessing] = useState(false);
	const [progressPercent, setProgressPercent] = useState(0);
	const [processingPhase, setProcessingPhase] =
		useState<ProcessingPhase>("idle");
	const [lastOutputName, setLastOutputName] = useState<string | null>(null);
	const [engineAvailability, setEngineAvailability] =
		useState<EngineAvailability | null>(null);

	const sourceWidth = mediaAsset?.width ?? 0;
	const sourceHeight = mediaAsset?.height ?? 0;
	const hasProcessableAsset = Boolean(
		mediaAsset?.file && sourceWidth > 0 && sourceHeight > 0,
	);

	useEffect(() => {
		if (!hasProcessableAsset) {
			return;
		}

		const defaults = buildDefaultRegion({
			width: sourceWidth,
			height: sourceHeight,
			preset,
		});
		setX(defaults.x.toString());
		setY(defaults.y.toString());
		setWidth(defaults.width.toString());
		setHeight(defaults.height.toString());
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
				setEngine((currentEngine) =>
					currentEngine === "veo" && !data.engines?.veo?.available
						? "ai"
						: currentEngine,
				);
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

	const regionSummary = useMemo(() => {
		const nextX = parseInput(x);
		const nextY = parseInput(y);
		const nextWidth = parseInput(width);
		const nextHeight = parseInput(height);

		if (
			nextX === null ||
			nextY === null ||
			nextWidth === null ||
			nextHeight === null ||
			nextWidth <= 0 ||
			nextHeight <= 0
		) {
			return null;
		}

		return {
			x: Math.min(nextX, Math.max(0, sourceWidth - 1)),
			y: Math.min(nextY, Math.max(0, sourceHeight - 1)),
			width: Math.min(nextWidth, sourceWidth),
			height: Math.min(nextHeight, sourceHeight),
		};
	}, [height, sourceHeight, sourceWidth, width, x, y]);

	const veoAvailable = engineAvailability?.veo.available ?? false;
	const aiUsesRunpod = engineAvailability?.ai.remote ?? false;

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

	useEffect(() => {
		if (!isProcessing) {
			setProgressPercent(0);
			setProcessingPhase("idle");
			return;
		}

		const interval = window.setInterval(() => {
			setProgressPercent((current) => {
				const phaseConfig: Record<
					ProcessingPhase,
					{ ceiling: number; step: number }
				> = {
					idle: { ceiling: 0, step: 0 },
					preparing: { ceiling: 8, step: 2 },
					uploading: { ceiling: 24, step: 3 },
					queued: { ceiling: 42, step: 2 },
					processing: { ceiling: 78, step: 2 },
					downloading: { ceiling: 88, step: 2 },
					importing: { ceiling: 95, step: 1 },
					cleaning: { ceiling: 98, step: 1 },
				};
				const { ceiling, step } =
					phaseConfig[processingPhase] ??
					(engine === "ai" && aiUsesRunpod
						? { ceiling: 92, step: 1 }
						: { ceiling: 88, step: 1 });

				return Math.min(current + step, ceiling);
			});
		}, 1200);

		return () => {
			window.clearInterval(interval);
		};
	}, [aiUsesRunpod, engine, isProcessing, processingPhase]);

	const phaseLabel = useMemo(() => {
		switch (processingPhase) {
			case "preparing":
				return "Preparing clip";
			case "uploading":
				return aiUsesRunpod ? "Uploading source" : "Preparing local job";
			case "queued":
				return "Queued on Runpod";
			case "processing":
				return engine === "ai" && aiUsesRunpod
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
	}, [aiUsesRunpod, engine, processingPhase]);

	const phaseDescription = useMemo(() => {
		switch (processingPhase) {
			case "preparing":
				return "Checking the selected clip and building the processing request.";
			case "uploading":
				return aiUsesRunpod
					? "Sending the source clip to temporary cloud storage for Runpod."
					: "Starting the local watermark cleanup pipeline.";
			case "queued":
				return "Waiting for an available worker to pick up the AI job.";
			case "processing":
				return engine === "ai" && aiUsesRunpod
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
	}, [aiUsesRunpod, engine, processingPhase]);

	const handleProcess = async () => {
		if (!activeProject || !mediaAsset?.file) {
			toast.error("No source video available");
			return;
		}

		if (
			engine === "fast" &&
			(!regionSummary || regionSummary.width <= 0 || regionSummary.height <= 0)
		) {
			toast.error("Enter a valid watermark region");
			return;
		}

		setIsProcessing(true);
		setProgressPercent(3);
		setProcessingPhase("preparing");
		try {
			const formData = new FormData();
			formData.append("file", mediaAsset.file, mediaAsset.file.name);
			formData.append("engine", engine);
			if (engine === "fast") {
				const safeRegion = regionSummary;
				if (!safeRegion) {
					throw new Error("Missing watermark region");
				}
				formData.append("x", safeRegion.x.toString());
				formData.append("y", safeRegion.y.toString());
				formData.append("width", safeRegion.width.toString());
				formData.append("height", safeRegion.height.toString());
			} else if (engine === "ai") {
				formData.append("detectionPrompt", detectionPrompt);
				formData.append("detectionSkip", detectionSkip);
				formData.append("fadeIn", fadeIn);
				formData.append("fadeOut", fadeOut);
			}

			setProcessingPhase("uploading");
			const response = await fetch("/api/watermark/run", {
				method: "POST",
				body: formData,
			});

			setProcessingPhase(
				engine === "ai" && aiUsesRunpod ? "processing" : "downloading",
			);

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
					setProcessingPhase("downloading");
				} else if (aiMode === "local-fallback" || aiMode === "local") {
					setProcessingPhase("processing");
				}
			}

			const blob = await response.blob();
			setProcessingPhase("importing");
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

			const insertTrackId = editor.timeline.addTrack({
				type: "video",
				index: insertTrackIndex,
			});
			const cleanedElement = buildElementFromMedia({
				mediaId: createdAsset.id,
				mediaType: createdAsset.type,
				name: createdAsset.name,
				duration: createdAsset.duration ?? element.duration,
				startTime: element.startTime,
			});
			editor.timeline.insertElement({
				element: cleanedElement,
				placement: { mode: "explicit", trackId: insertTrackId },
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
					elements: [{ trackId: insertTrackId, elementId: insertedElement.id }],
				});
			}
			setProcessingPhase("cleaning");
			setProgressPercent(100);
			setLastOutputName(createdAsset.name);

			toast.success("Watermark cleanup finished", {
				description:
					"A cleaned clip was added above the original. The original clip was hidden and muted so the result is visible immediately.",
			});
			if (engine === "ai" && aiMode === "local-fallback" && aiModeReason) {
				toast.info("Runpod upload limit reached", {
					description: aiModeReason,
				});
			}
		} catch (error) {
			console.error(error);
			toast.error("Watermark cleanup failed", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setIsProcessing(false);
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

				<div className="grid grid-cols-3 gap-2">
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
					<button
						type="button"
						onClick={() => setEngine("veo")}
						disabled={!veoAvailable}
						className={`rounded-lg border px-3 py-3 text-left transition ${
							engine === "veo"
								? "border-primary bg-primary/10"
								: "hover:bg-accent/40"
						} ${!veoAvailable ? "cursor-not-allowed opacity-50" : ""}`}
					>
						<div className="text-sm font-medium">Veo Remove</div>
						<div className="text-muted-foreground mt-1 text-xs">
							Uses AllenKuo's Veo binary if `GeminiWatermarkTool-Video.exe` is
							present.
						</div>
					</button>
				</div>

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

					{engine === "fast" ? (
						<>
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
								<div className="grid grid-cols-2 gap-2">
									<NumberField
										icon="X"
										value={x}
										onChange={(event) => setX(event.currentTarget.value)}
									/>
									<NumberField
										icon="Y"
										value={y}
										onChange={(event) => setY(event.currentTarget.value)}
									/>
									<NumberField
										icon="W"
										value={width}
										onChange={(event) => setWidth(event.currentTarget.value)}
									/>
									<NumberField
										icon="H"
										value={height}
										onChange={(event) => setHeight(event.currentTarget.value)}
									/>
								</div>
							</SectionField>
						</>
					) : engine === "ai" ? (
						<>
							<SectionField label="Detection prompt">
								<NumberField
									value={detectionPrompt}
									onChange={(event) =>
										setDetectionPrompt(event.currentTarget.value)
									}
								/>
							</SectionField>
							<SectionField label="AI timing">
								<div className="grid grid-cols-3 gap-2">
									<NumberField
										icon="S"
										value={detectionSkip}
										onChange={(event) =>
											setDetectionSkip(event.currentTarget.value)
										}
									/>
									<NumberField
										icon="In"
										value={fadeIn}
										onChange={(event) => setFadeIn(event.currentTarget.value)}
									/>
									<NumberField
										icon="Out"
										value={fadeOut}
										onChange={(event) => setFadeOut(event.currentTarget.value)}
									/>
								</div>
							</SectionField>
						</>
					) : (
						<SectionField label="Veo binary">
							<div className="rounded-md border bg-accent/20 px-3 py-2 text-sm">
								<div className="font-medium">GeminiWatermarkTool-Video.exe</div>
								<div className="text-muted-foreground mt-1">
									Place the Veo release binary in `vendor/VeoWatermarkRemover`{" "}
									to enable this engine.
								</div>
							</div>
						</SectionField>
					)}
				</SectionFields>

				{engine === "fast" ? (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						{regionSummary
							? `FFmpeg delogo region: x ${regionSummary.x}, y ${regionSummary.y}, width ${regionSummary.width}, height ${regionSummary.height}`
							: "Enter a valid region to enable processing."}
					</div>
				) : engine === "ai" ? (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						AI mode uses {detectionPrompt || "watermark"} detection. If Runpod
						{aiUsesRunpod
							? " is configured, so this will run remotely on your endpoint."
							: " is not configured yet, so this will fall back to local CPU processing."}{" "}
						Faster defaults are set to skip more frames and disable fade
						expansion.
					</div>
				) : (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						Veo Remove is designed for Veo watermarks and should be much faster
						than the AI mode, but it requires the Veo release executable in the
						vendor folder first.{" "}
						{engineAvailability?.veo.reason
							? engineAvailability.veo.reason
							: ""}
					</div>
				)}

				<div className="rounded-md border px-3 py-2 text-sm">
					<div className="font-medium">
						{isProcessing
							? `Processing clip... ${progressPercent}%`
							: lastOutputName
								? "Last cleaned result"
								: "Ready to run"}
					</div>
					<div className="text-muted-foreground mt-1">
						{isProcessing
							? `${phaseLabel ?? "Processing"} on ${
									mediaAsset?.name ?? "selected clip"
								}.`
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
						(engine === "fast" && !regionSummary) ||
						isProcessing
					}
					className="w-full"
				>
					{isProcessing ? "Processing..." : "Remove watermark"}
				</Button>
			</SectionContent>
		</Section>
	);
}
