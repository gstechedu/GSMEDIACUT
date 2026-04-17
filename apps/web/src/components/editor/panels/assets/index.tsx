"use client";

import { MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { type Tab, useAssetsPanelStore } from "@/stores/assets-panel-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { usePropertiesStore } from "../properties/stores/properties-store";
import { hasMediaId } from "@/lib/timeline";
import { TabBar } from "./tabbar";
import { Captions } from "./views/captions";
import { MediaView } from "./views/assets";
import { SettingsView } from "./views/settings";
import { SoundsView } from "./views/sounds";
import { StudioView } from "./views/studio";
import { StickersView } from "./views/stickers";
import { TextView } from "./views/text";
import { EffectsView } from "./views/effects";
import { TranscriptionView } from "./views/transcription";
import { TransitionsView } from "./views/transitions";

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();
	const editor = useEditor();
	const mediaAssets = useEditor((currentEditor) =>
		currentEditor.media.getAssets(),
	);
	const { selectedElements } = useElementSelection();
	const setActivePropertiesTab = usePropertiesStore((state) => state.setActiveTab);
	const setTimelineEditorMode = useTimelineStore(
		(state) => state.setEditorMode,
	);
	const selectedElementWithTrack =
		selectedElements.length === 1
			? (editor.timeline.getElementsWithTracks({
					elements: selectedElements,
				})[0] ?? null)
			: null;
	const selectedElement = selectedElementWithTrack?.element ?? null;
	const selectedMediaAsset =
		selectedElement && hasMediaId(selectedElement)
			? mediaAssets.find(
					(asset) => asset.id === selectedElement.mediaId,
				) ?? null
			: null;
	const canOpenTransitionPanel =
		!!selectedElementWithTrack &&
		(selectedElementWithTrack.element.type === "audio" ||
			(selectedElementWithTrack.element.type === "video" &&
				selectedMediaAsset?.hasAudio !== false));

	const openTransitionPanel = () => {
		if (!selectedElementWithTrack) {
			return;
		}

		setActivePropertiesTab(selectedElementWithTrack.element.type, "transition");
		setTimelineEditorMode("transition");
	};

	const viewMap: Record<Tab, React.ReactNode> = {
		studio: <StudioView />,
		media: <MediaView />,
		sounds: <SoundsView />,
		text: <TextView />,
		stickers: <StickersView />,
		effects: <EffectsView />,
		transitions: <TransitionsView />,
		transcription: <TranscriptionView />,
		captions: <Captions />,
		filters: (
			<div className="text-muted-foreground p-4">
				Filters view coming soon...
			</div>
		),
		adjustment: (
			<div className="text-muted-foreground p-4">
				Adjustment view coming soon...
			</div>
		),
		settings: <SettingsView />,
	};

	return (
		<div className="panel bg-background flex h-full rounded-sm border overflow-hidden">
			<TabBar />
			<Separator orientation="vertical" />
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<div className="border-b px-2 py-2">
					<Button
						className="w-full justify-between"
						size="sm"
						variant="secondary"
						onClick={openTransitionPanel}
						disabled={!canOpenTransitionPanel}
					>
						Open Transition Panel
						<MoveRight className="size-4" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden">
					{viewMap[activeTab]}
				</div>
			</div>
		</div>
	);
}
