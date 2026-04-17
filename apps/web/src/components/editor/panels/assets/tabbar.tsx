"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import {
	TAB_KEYS,
	tabs,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { usePropertiesStore } from "../properties/stores/properties-store";
import { hasMediaId } from "@/lib/timeline";

export function TabBar() {
	const { activeTab, setActiveTab } = useAssetsPanelStore();
	const editor = useEditor();
	const mediaAssets = useEditor((currentEditor) =>
		currentEditor.media.getAssets(),
	);
	const { selectedElements } = useElementSelection();
	const setActivePropertiesTab = usePropertiesStore((state) => state.setActiveTab);
	const setTimelineEditorMode = useTimelineStore(
		(state) => state.setEditorMode,
	);
	const [showTopFade, setShowTopFade] = useState(false);
	const [showBottomFade, setShowBottomFade] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
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

	const checkScrollPosition = useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;

		const { scrollTop, scrollHeight, clientHeight } = element;
		setShowTopFade(scrollTop > 0);
		setShowBottomFade(scrollTop < scrollHeight - clientHeight - 1);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		checkScrollPosition();
		element.addEventListener("scroll", checkScrollPosition);

		const resizeObserver = new ResizeObserver(checkScrollPosition);
		resizeObserver.observe(element);

		return () => {
			element.removeEventListener("scroll", checkScrollPosition);
			resizeObserver.disconnect();
		};
	}, [checkScrollPosition]);

	return (
		<div className="relative flex">
			<div
				ref={scrollRef}
				className="scrollbar-hidden relative flex size-full p-1 flex-col items-center justify-start gap-0.5 overflow-y-auto"
			>
				{TAB_KEYS.map((tabKey) => {
					const tab = tabs[tabKey];
					return (
						<Tooltip key={tabKey} delayDuration={10}>
							<TooltipTrigger asChild>
								<Button
									variant={
										tabKey === "transitions"
											? "ghost"
											: activeTab === tabKey
												? "secondary"
												: "ghost"
									}
									size="icon"
									aria-label={tab.label}
									disabled={tabKey === "transitions" && !canOpenTransitionPanel}
									className={cn(
										"shrink-0",
										"h-8 w-8",
										tabKey === "transitions"
											? "text-muted-foreground"
											: activeTab !== tabKey && "text-muted-foreground",
									)}
									onClick={() => {
										if (tabKey === "transitions") {
											if (!selectedElementWithTrack) {
												return;
											}

											setActivePropertiesTab(
												selectedElementWithTrack.element.type,
												"transition",
											);
											setTimelineEditorMode("transition");
											return;
										}

										setTimelineEditorMode("timeline");
										setActiveTab(tabKey);
									}}
								>
									<tab.icon />
								</Button>
							</TooltipTrigger>
							<TooltipContent
								side="right"
								align="center"
								variant="sidebar"
								sideOffset={8}
							>
								<div className="text-foreground text-sm leading-none font-medium">
									{tab.label}
								</div>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>

			<FadeOverlay direction="top" show={showTopFade} />
			<FadeOverlay direction="bottom" show={showBottomFade} />
		</div>
	);
}

function FadeOverlay({
	direction,
	show,
}: {
	direction: "top" | "bottom";
	show: boolean;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute right-0 left-0 h-6",
				direction === "top" && show
					? "from-background top-0 bg-linear-to-b to-transparent"
					: "from-background bottom-0 bg-linear-to-t to-transparent",
			)}
		/>
	);
}
