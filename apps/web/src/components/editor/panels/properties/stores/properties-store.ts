import { create } from "zustand";

export interface WatermarkRegionSelectionRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface WatermarkRegionSelectionState {
	active: boolean;
	trackId: string | null;
	elementId: string | null;
	regionIndex: number | null;
	region: WatermarkRegionSelectionRegion | null;
}

interface PropertiesState {
	activeTabPerType: Record<string, string>;
	setActiveTab: (elementType: string, tabId: string) => void;
	selectedTransitionPresetByElement: Record<string, string>;
	setSelectedTransitionPreset: (key: string, presetId: string) => void;
	isTransformScaleLocked: boolean;
	setTransformScaleLocked: (locked: boolean) => void;
	watermarkRegionSelection: WatermarkRegionSelectionState;
	startWatermarkRegionSelection: (params: {
		trackId: string;
		elementId: string;
		regionIndex: number;
		region: WatermarkRegionSelectionRegion | null;
	}) => void;
	updateWatermarkRegionSelection: (
		region: WatermarkRegionSelectionRegion,
	) => void;
	finishWatermarkRegionSelection: (
		region?: WatermarkRegionSelectionRegion,
	) => void;
	cancelWatermarkRegionSelection: () => void;
}

export const usePropertiesStore = create<PropertiesState>()((set) => ({
	activeTabPerType: {},
	setActiveTab: (elementType, tabId) =>
		set((state) => ({
			activeTabPerType: { ...state.activeTabPerType, [elementType]: tabId },
		})),
	selectedTransitionPresetByElement: {},
	setSelectedTransitionPreset: (key, presetId) =>
		set((state) => ({
			selectedTransitionPresetByElement: {
				...state.selectedTransitionPresetByElement,
				[key]: presetId,
			},
		})),
	isTransformScaleLocked: false,
	setTransformScaleLocked: (locked) => set({ isTransformScaleLocked: locked }),
	watermarkRegionSelection: {
		active: false,
		trackId: null,
		elementId: null,
		regionIndex: null,
		region: null,
	},
	startWatermarkRegionSelection: ({
		trackId,
		elementId,
		regionIndex,
		region,
	}) =>
		set({
			watermarkRegionSelection: {
				active: true,
				trackId,
				elementId,
				regionIndex,
				region,
			},
		}),
	updateWatermarkRegionSelection: (region) =>
		set((state) => ({
			watermarkRegionSelection: {
				...state.watermarkRegionSelection,
				region,
			},
		})),
	finishWatermarkRegionSelection: (region) =>
		set((state) => ({
			watermarkRegionSelection: {
				...state.watermarkRegionSelection,
				active: false,
				region: region ?? state.watermarkRegionSelection.region,
			},
		})),
	cancelWatermarkRegionSelection: () =>
		set((state) => ({
			watermarkRegionSelection: {
				...state.watermarkRegionSelection,
				active: false,
			},
		})),
}));
