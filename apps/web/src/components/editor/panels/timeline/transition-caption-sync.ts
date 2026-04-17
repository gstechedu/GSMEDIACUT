"use client";

import { useEffect } from "react";
import { useEditor } from "@/hooks/use-editor";
import { DEFAULTS } from "@/lib/timeline/defaults";
import { buildEmptyTrack } from "@/lib/timeline/placement";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import {
	useTimelineStore,
	type TransitionTranscriptRow,
} from "@/stores/timeline-store";
import { generateUUID } from "@/utils/id";
import type { TextElement } from "@/lib/timeline";

const TRANSITION_CAPTION_TRACK_NAME = "Transition Captions";
const MIN_CAPTION_DURATION_TICKS = 1;
const DEFAULT_TRANSITION_CAPTION_OFFSET_Y = 260;

function buildCaptionElement(
	row: TransitionTranscriptRow,
	index: number,
	existingElement?: TextElement,
) {
	const startTime = Math.max(
		0,
		Math.round(row.startSeconds * TICKS_PER_SECOND),
	);
	const duration = Math.max(
		MIN_CAPTION_DURATION_TICKS,
		Math.round(
			Math.max(0, row.endSeconds - row.startSeconds) * TICKS_PER_SECOND,
		),
	);

	return {
		...DEFAULTS.text.element,
		id: `transition-caption:${row.id}`,
		name: `Transition Caption ${index + 1}`,
		content: row.text.trim() || row.originalText.trim(),
		startTime,
		duration,
		fontSize: 18,
		fontWeight: "bold" as const,
		lineHeight: 1.1,
		transform: {
			...DEFAULTS.text.element.transform,
			...(existingElement?.transform ?? {}),
			position: existingElement?.transform.position ?? {
				x: 0,
				y: DEFAULT_TRANSITION_CAPTION_OFFSET_Y,
			},
		},
		background: {
			...DEFAULTS.text.element.background,
			...(existingElement?.background ?? {}),
			enabled: true,
			color: "#000000",
			paddingX: 10,
			paddingY: 8,
			cornerRadius: 10,
		},
	};
}

export function useSyncTransitionCaptions() {
	const editor = useEditor();
	const rows = useTimelineStore((state) => state.transitionTranscriptRows);
	const sourceLabel = useTimelineStore(
		(state) => state.transitionTranscriptSourceLabel,
	);
	const transitionCaptionTrackId = useTimelineStore(
		(state) => state.transitionCaptionTrackId,
	);
	const setTransitionCaptionTrackId = useTimelineStore(
		(state) => state.setTransitionCaptionTrackId,
	);

	useEffect(() => {
		const activeScene = editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return;
		}

		const currentTracks = activeScene.tracks;
		const existingTrack =
			(transitionCaptionTrackId
				? currentTracks.overlay.find(
						(track) =>
							track.id === transitionCaptionTrackId && track.type === "text",
					)
				: null) ??
			currentTracks.overlay.find(
				(track) =>
					track.type === "text" &&
					track.name.startsWith(TRANSITION_CAPTION_TRACK_NAME),
			);

		if (rows.length === 0) {
			if (existingTrack) {
				editor.timeline.updateTracks({
					...currentTracks,
					overlay: currentTracks.overlay.filter(
						(track) => track.id !== existingTrack.id,
					),
				});
			}
			if (transitionCaptionTrackId !== null) {
				setTransitionCaptionTrackId(null);
			}
			return;
		}

		const nextTrackId = existingTrack?.id ?? generateUUID();
		const nextTrack = {
			...(existingTrack ??
				buildEmptyTrack({
					id: nextTrackId,
					type: "text",
					name: TRANSITION_CAPTION_TRACK_NAME,
				})),
			id: nextTrackId,
			name: sourceLabel
				? `${TRANSITION_CAPTION_TRACK_NAME} | ${sourceLabel}`
				: TRANSITION_CAPTION_TRACK_NAME,
			type: "text" as const,
			elements: rows.map((row, index) => {
				const existingElement = existingTrack?.elements.find(
					(element) => element.id === `transition-caption:${row.id}`,
				);
				return buildCaptionElement(
					row,
					index,
					existingElement?.type === "text" ? existingElement : undefined,
				);
			}),
		};

		const nextOverlay = existingTrack
			? currentTracks.overlay.map((track) =>
					track.id === existingTrack.id ? nextTrack : track,
				)
			: [nextTrack, ...currentTracks.overlay];

		editor.timeline.updateTracks({
			...currentTracks,
			overlay: nextOverlay,
		});

		if (transitionCaptionTrackId !== nextTrackId) {
			setTransitionCaptionTrackId(nextTrackId);
		}
	}, [
		editor,
		rows,
		sourceLabel,
		transitionCaptionTrackId,
		setTransitionCaptionTrackId,
	]);
}
