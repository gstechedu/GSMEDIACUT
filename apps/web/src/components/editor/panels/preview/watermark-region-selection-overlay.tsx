"use client";

import { useRef } from "react";
import { usePreviewViewport } from "@/components/editor/panels/preview/preview-viewport";
import { useEditor } from "@/hooks/use-editor";
import { getVisibleElementsWithBounds } from "@/lib/preview/element-bounds";
import { usePropertiesStore } from "../properties/stores/properties-store";

function clampRegion({
	startX,
	startY,
	endX,
	endY,
	maxWidth,
	maxHeight,
}: {
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	maxWidth: number;
	maxHeight: number;
}) {
	const clamp = (value: number, max: number) =>
		Math.max(0, Math.min(max, Math.round(value)));
	const left = clamp(Math.min(startX, endX), maxWidth);
	const top = clamp(Math.min(startY, endY), maxHeight);
	const right = clamp(Math.max(startX, endX), maxWidth);
	const bottom = clamp(Math.max(startY, endY), maxHeight);

	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	};
}

export function WatermarkRegionSelectionOverlay() {
	const viewport = usePreviewViewport();
	const selection = usePropertiesStore((s) => s.watermarkRegionSelection);
	const updateSelection = usePropertiesStore(
		(s) => s.updateWatermarkRegionSelection,
	);
	const finishSelection = usePropertiesStore(
		(s) => s.finishWatermarkRegionSelection,
	);
	const cancelSelection = usePropertiesStore(
		(s) => s.cancelWatermarkRegionSelection,
	);
	const dragStateRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
	} | null>(null);
	const selectedElements = useEditor((e) => e.selection.getSelectedElements());
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const currentTime = useEditor((e) => e.playback.getCurrentTime());
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const canvasSize = useEditor(
		(e) => e.project.getActive().settings.canvasSize,
	);

	if (!selection.active) {
		return null;
	}

	const selectedRef =
		selectedElements.length === 1 ? (selectedElements[0] ?? null) : null;
	const selectedWithBounds = selectedRef
		? (getVisibleElementsWithBounds({
				tracks,
				currentTime,
				canvasSize,
				mediaAssets,
			}).find(
				(entry) =>
					entry.trackId === selectedRef.trackId &&
					entry.elementId === selectedRef.elementId,
			) ?? null)
		: null;
	const selectedElement = selectedWithBounds?.element ?? null;
	const selectedMedia =
		selectedElement &&
		("mediaId" in selectedElement
			? (mediaAssets.find((asset) => asset.id === selectedElement.mediaId) ??
				null)
			: null);
	const selectedSourceWidth = selectedMedia?.width ?? null;
	const selectedSourceHeight = selectedMedia?.height ?? null;
	const selectedBounds = selectedWithBounds?.bounds ?? null;

	if (
		!selectedBounds ||
		!selectedSourceWidth ||
		!selectedSourceHeight ||
		selectedBounds.width <= 0 ||
		selectedBounds.height <= 0
	) {
		return null;
	}

	const elementLeft = selectedBounds.cx - selectedBounds.width / 2;
	const elementTop = selectedBounds.cy - selectedBounds.height / 2;

	const overlayRect = selection.region
		? (() => {
				const topLeft = viewport.canvasToOverlay({
					canvasX:
						elementLeft +
						(selection.region.x / selectedSourceWidth) * selectedBounds.width,
					canvasY:
						elementTop +
						(selection.region.y / selectedSourceHeight) * selectedBounds.height,
				});
				const bottomRight = viewport.canvasToOverlay({
					canvasX:
						elementLeft +
						((selection.region.x + selection.region.width) /
							selectedSourceWidth) *
							selectedBounds.width,
					canvasY:
						elementTop +
						((selection.region.y + selection.region.height) /
							selectedSourceHeight) *
							selectedBounds.height,
				});
				return {
					left: topLeft.x,
					top: topLeft.y,
					width: Math.max(1, bottomRight.x - topLeft.x),
					height: Math.max(1, bottomRight.y - topLeft.y),
				};
			})()
		: null;

	return (
		<div
			className="absolute inset-0 pointer-events-auto"
			role="presentation"
			onPointerDown={(event) => {
				const canvasPoint = viewport.screenToCanvas({
					clientX: event.clientX,
					clientY: event.clientY,
				});
				if (!canvasPoint) {
					return;
				}

				const relativeX = canvasPoint.x - elementLeft;
				const relativeY = canvasPoint.y - elementTop;
				if (
					relativeX < 0 ||
					relativeY < 0 ||
					relativeX > selectedBounds.width ||
					relativeY > selectedBounds.height
				) {
					return;
				}

				const sourceX =
					(relativeX / selectedBounds.width) * selectedSourceWidth;
				const sourceY =
					(relativeY / selectedBounds.height) * selectedSourceHeight;

				dragStateRef.current = {
					pointerId: event.pointerId,
					startX: sourceX,
					startY: sourceY,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
				updateSelection(
					clampRegion({
						startX: sourceX,
						startY: sourceY,
						endX: sourceX,
						endY: sourceY,
						maxWidth: selectedSourceWidth,
						maxHeight: selectedSourceHeight,
					}),
				);
			}}
			onPointerMove={(event) => {
				const dragState = dragStateRef.current;
				if (!dragState || dragState.pointerId !== event.pointerId) {
					return;
				}

				const canvasPoint = viewport.screenToCanvas({
					clientX: event.clientX,
					clientY: event.clientY,
				});
				if (!canvasPoint) {
					return;
				}

				const sourceX =
					((canvasPoint.x - elementLeft) / selectedBounds.width) *
					selectedSourceWidth;
				const sourceY =
					((canvasPoint.y - elementTop) / selectedBounds.height) *
					selectedSourceHeight;

				updateSelection(
					clampRegion({
						startX: dragState.startX,
						startY: dragState.startY,
						endX: sourceX,
						endY: sourceY,
						maxWidth: selectedSourceWidth,
						maxHeight: selectedSourceHeight,
					}),
				);
			}}
			onPointerUp={(event) => {
				const dragState = dragStateRef.current;
				if (!dragState || dragState.pointerId !== event.pointerId) {
					return;
				}

				const canvasPoint = viewport.screenToCanvas({
					clientX: event.clientX,
					clientY: event.clientY,
				});
				if (canvasPoint) {
					const sourceX =
						((canvasPoint.x - elementLeft) / selectedBounds.width) *
						selectedSourceWidth;
					const sourceY =
						((canvasPoint.y - elementTop) / selectedBounds.height) *
						selectedSourceHeight;
					const nextRegion = clampRegion({
						startX: dragState.startX,
						startY: dragState.startY,
						endX: sourceX,
						endY: sourceY,
						maxWidth: selectedSourceWidth,
						maxHeight: selectedSourceHeight,
					});
					updateSelection(nextRegion);
					finishSelection(nextRegion);
				} else {
					finishSelection();
				}

				dragStateRef.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			}}
			onPointerCancel={(event) => {
				const dragState = dragStateRef.current;
				if (!dragState || dragState.pointerId !== event.pointerId) {
					return;
				}

				dragStateRef.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
				cancelSelection();
			}}
		>
			<div className="absolute inset-x-0 top-3 flex justify-center">
				<div className="rounded-full border border-white/20 bg-black/70 px-3 py-1 text-xs text-white shadow">
					Drag on the real preview to mark the watermark area
				</div>
			</div>
			{overlayRect ? (
				<div
					className="pointer-events-none absolute border-2 border-sky-400 bg-sky-500/20 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]"
					style={{
						left: overlayRect.left,
						top: overlayRect.top,
						width: overlayRect.width,
						height: overlayRect.height,
					}}
				/>
			) : null}
		</div>
	);
}
