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
	trackId: _trackId,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
	trackId: string;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const [engine, setEngine] = useState<WatermarkEngine>("fast");
	const [preset, setPreset] = useState<PresetKey>("top-left");
	const [x, setX] = useState("0");
	const [y, setY] = useState("0");
	const [width, setWidth] = useState("0");
	const [height, setHeight] = useState("0");
	const [detectionPrompt, setDetectionPrompt] = useState("watermark");
	const [detectionSkip, setDetectionSkip] = useState("6");
	const [fadeIn, setFadeIn] = useState("0.0");
	const [fadeOut, setFadeOut] = useState("0.0");
	const [isProcessing, setIsProcessing] = useState(false);
	const [lastOutputName, setLastOutputName] = useState<string | null>(null);

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
		try {
			const formData = new FormData();
			formData.append("file", mediaAsset.file, mediaAsset.file.name);
			formData.append("engine", engine);
			if (engine === "fast") {
				formData.append("x", regionSummary.x.toString());
				formData.append("y", regionSummary.y.toString());
				formData.append("width", regionSummary.width.toString());
				formData.append("height", regionSummary.height.toString());
			} else if (engine === "ai") {
				formData.append("detectionPrompt", detectionPrompt);
				formData.append("detectionSkip", detectionSkip);
				formData.append("fadeIn", fadeIn);
				formData.append("fadeOut", fadeOut);
			}

			const response = await fetch("/api/watermark/run", {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Watermark cleanup failed");
			}

			const blob = await response.blob();
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
				index: 0,
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
			editor.selection.setSelectedElements({
				elements: [{ trackId: insertTrackId, elementId: cleanedElement.id }],
			});
			setLastOutputName(createdAsset.name);

			toast.success("Watermark cleanup finished", {
				description:
					"A cleaned clip was added to Media and stacked above the original on the timeline.",
			});
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
						className={`rounded-lg border px-3 py-3 text-left transition ${
							engine === "veo"
								? "border-primary bg-primary/10"
								: "hover:bg-accent/40"
						}`}
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
						AI mode uses {detectionPrompt || "watermark"} detection. This PC is
						currently running the model on CPU, so it will be slow. Faster
						defaults are now set to skip more frames and disable fade expansion.
					</div>
				) : (
					<div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
						Veo Remove is designed for Veo watermarks and should be much faster
						than the AI mode, but it requires the Veo release executable in the
						vendor folder first.
					</div>
				)}

				<div className="rounded-md border px-3 py-2 text-sm">
					<div className="font-medium">
						{isProcessing
							? "Processing clip..."
							: lastOutputName
								? "Last cleaned result"
								: "Ready to run"}
					</div>
					<div className="text-muted-foreground mt-1">
						{isProcessing
							? `Running ${
									engine === "ai"
										? "AI"
										: engine === "veo"
											? "Veo Remove"
											: "Fast"
								} cleanup on ${mediaAsset?.name ?? "selected clip"}.`
							: lastOutputName
								? `${lastOutputName} was added to Media and selected on the timeline.`
								: "Choose an engine, adjust settings, then click Remove watermark."}
					</div>
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
