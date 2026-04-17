/**
 * UI state for the timeline
 * For core logic, use EditorCore instead.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClipboardItem } from "@/lib/timeline";

export interface TransitionTranscriptRow {
	id: string;
	startSeconds: number;
	endSeconds: number;
	originalText: string;
	text: string;
	style: string;
	emotion: string;
	voiceModel: string;
	speedPercent: number;
	pitchSemitones: number;
	echoPercent: number;
	volumeDb: number;
	audioLabel: string;
}

export const TRANSITION_ACTING_ENGINES = [
	"TTS",
	"Kokoro",
	"StyleTTS2",
] as const;

export type TransitionActingEngine = (typeof TRANSITION_ACTING_ENGINES)[number];

export function normalizeTransitionActingEngine(
	value: string | null | undefined,
): TransitionActingEngine {
	return TRANSITION_ACTING_ENGINES.includes(value as TransitionActingEngine)
		? (value as TransitionActingEngine)
		: "StyleTTS2";
}

interface TimelineStore {
	snappingEnabled: boolean;
	toggleSnapping: () => void;
	rippleEditingEnabled: boolean;
	toggleRippleEditing: () => void;
	editorMode: "timeline" | "transition";
	setEditorMode: (mode: "timeline" | "transition") => void;
	transitionTranscriptRows: TransitionTranscriptRow[];
	transitionTranscriptSourceLabel: string | null;
	transitionTranscriptEngineLabel: string;
	transitionCaptionTrackId: string | null;
	setTransitionTranscript: (params: {
		rows: TransitionTranscriptRow[];
		sourceLabel: string | null;
		engineLabel?: string;
	}) => void;
	addTransitionTranscriptRow: (row: TransitionTranscriptRow) => void;
	updateTransitionTranscriptRow: (
		rowId: string,
		patch: Partial<TransitionTranscriptRow>,
	) => void;
	removeTransitionTranscriptRow: (rowId: string) => void;
	setTransitionCaptionTrackId: (trackId: string | null) => void;
	clearTransitionTranscript: () => void;
	clipboard: {
		items: ClipboardItem[];
	} | null;
	setClipboard: (
		clipboard: {
			items: ClipboardItem[];
		} | null,
	) => void;
}

export const useTimelineStore = create<TimelineStore>()(
	persist(
		(set) => ({
			snappingEnabled: true,

			toggleSnapping: () => {
				set((state) => ({ snappingEnabled: !state.snappingEnabled }));
			},

			rippleEditingEnabled: false,

			toggleRippleEditing: () => {
				set((state) => ({
					rippleEditingEnabled: !state.rippleEditingEnabled,
				}));
			},

			editorMode: "timeline",

			setEditorMode: (mode) => {
				set({ editorMode: mode });
			},

			transitionTranscriptRows: [],
			transitionTranscriptSourceLabel: null,
			transitionTranscriptEngineLabel: "StyleTTS2",
			transitionCaptionTrackId: null,

			setTransitionTranscript: ({ rows, sourceLabel, engineLabel }) => {
				set({
					transitionTranscriptRows: rows,
					transitionTranscriptSourceLabel: sourceLabel,
					transitionTranscriptEngineLabel:
						normalizeTransitionActingEngine(engineLabel),
				});
			},

			addTransitionTranscriptRow: (row) => {
				set((state) => ({
					transitionTranscriptRows: [...state.transitionTranscriptRows, row],
				}));
			},

			updateTransitionTranscriptRow: (rowId, patch) => {
				set((state) => ({
					transitionTranscriptRows: state.transitionTranscriptRows.map((row) =>
						row.id === rowId ? { ...row, ...patch } : row,
					),
				}));
			},

			removeTransitionTranscriptRow: (rowId) => {
				set((state) => ({
					transitionTranscriptRows: state.transitionTranscriptRows.filter(
						(row) => row.id !== rowId,
					),
				}));
			},

			setTransitionCaptionTrackId: (trackId) => {
				set({ transitionCaptionTrackId: trackId });
			},

			clearTransitionTranscript: () => {
				set({
					transitionTranscriptRows: [],
					transitionTranscriptSourceLabel: null,
					transitionTranscriptEngineLabel: "StyleTTS2",
					transitionCaptionTrackId: null,
				});
			},

			clipboard: null,

			setClipboard: (clipboard) => {
				set({ clipboard });
			},
		}),
		{
			name: "timeline-store",
			partialize: (state) => ({
				snappingEnabled: state.snappingEnabled,
				rippleEditingEnabled: state.rippleEditingEnabled,
			}),
		},
	),
);
