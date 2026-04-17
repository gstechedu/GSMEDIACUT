"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { useEffect, useMemo } from "react";
import { usePropertiesStore } from "./stores/properties-store";
import { getPropertiesConfig } from "./registry";
import { cn } from "@/utils/ui";
import { EmptyView } from "./empty-view";
import { useTimelineStore } from "@/stores/timeline-store";
import { MultiSelectionPanel } from "./multi-selection-panel";
import { hasMediaId } from "@/lib/timeline/element-utils";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";
import { useWatermarkJobsStore } from "@/stores/watermark-jobs-store";

export function PropertiesPanel() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	useEditor((e) => e.media.getAssets());
	const { selectedElements } = useElementSelection();
	const { activeTabPerType, setActiveTab } = usePropertiesStore();
	const setTimelineEditorMode = useTimelineStore(
		(state) => state.setEditorMode,
	);
	const mediaAssets = editor.media.getAssets();
	const elementWithTrack =
		selectedElements.length === 1
			? (editor.timeline.getElementsWithTracks({
					elements: selectedElements,
				})[0] ?? null)
			: null;
	const selectedElement = elementWithTrack?.element ?? null;
	const config = selectedElement
		? getPropertiesConfig({ element: selectedElement, mediaAssets })
		: null;
	const visibleTabs = config?.tabs ?? [];
	const storedTabId = selectedElement
		? activeTabPerType[selectedElement.type]
		: null;
	const isStoredTabVisible = visibleTabs.some((tab) => tab.id === storedTabId);
	const activeTabId =
		config && storedTabId && isStoredTabVisible
			? storedTabId
			: config?.defaultTab;
	const activeTab =
		visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0] ?? null;
	const currentAssetId =
		selectedElement && hasMediaId(selectedElement)
			? selectedElement.mediaId
			: null;
	const backgroundTasksByKey = useBackgroundTasksStore(
		(state) => state.tasksByKey,
	);
	const watermarkJobsByAssetId = useWatermarkJobsStore(
		(state) => state.jobsByAssetId,
	);
	const activeBackgroundItems = useMemo(() => {
		const sharedTasks = Object.values(backgroundTasksByKey)
			.filter((task) => task.status === "running")
			.filter((task) => {
				if (!selectedElement) {
					return false;
				}
				if (task.elementId && task.elementId === selectedElement.id) {
					return true;
				}
				if (currentAssetId && task.assetId === currentAssetId) {
					return true;
				}
				return false;
			})
			.map((task) => ({
				key: task.key,
				title: task.title,
				message: task.message,
				detail: task.detail,
				progress: task.progress,
				tone: "sky" as const,
			}));
		const watermarkJob = currentAssetId
			? (watermarkJobsByAssetId[currentAssetId] ?? null)
			: null;
		const watermarkItems =
			watermarkJob?.status === "running"
				? [
						{
							key: `watermark:${watermarkJob.jobId}`,
							title: "Watermark",
							message: watermarkJob.message,
							detail: watermarkJob.detail,
							progress: watermarkJob.progress,
							tone: "emerald" as const,
						},
					]
				: [];

		return [...watermarkItems, ...sharedTasks];
	}, [
		backgroundTasksByKey,
		currentAssetId,
		selectedElement,
		watermarkJobsByAssetId,
	]);

	useEffect(() => {
		if (selectedElements.length !== 1 || !selectedElement) {
			setTimelineEditorMode("timeline");
			return;
		}

		setTimelineEditorMode(
			activeTab?.id === "transition" ? "transition" : "timeline",
		);
	}, [
		activeTab?.id,
		selectedElement,
		selectedElements.length,
		setTimelineEditorMode,
	]);

	if (selectedElements.length === 0) {
		return (
			<div className="panel bg-background flex h-full flex-col items-center justify-center overflow-hidden rounded-sm border">
				<EmptyView />
			</div>
		);
	}

	if (selectedElements.length > 1) {
		return <MultiSelectionPanel selectedElements={selectedElements} />;
	}

	if (!elementWithTrack) return null;
	const { element, track } = elementWithTrack;

	if (!activeTab) return null;

	return (
		<div className="panel bg-background flex h-full overflow-hidden rounded-sm border">
			<TooltipProvider delayDuration={0}>
				<div className="flex shrink-0 flex-col gap-0.5 border-r p-1 scrollbar-hidden overflow-y-auto">
					{visibleTabs.map((tab) => (
						<Tooltip key={tab.id}>
							<TooltipTrigger asChild>
								<Button
									variant={tab.id === activeTab.id ? "secondary" : "ghost"}
									size="icon"
									onClick={() => {
										setActiveTab(element.type, tab.id);
										setTimelineEditorMode(
											tab.id === "transition" ? "transition" : "timeline",
										);
									}}
									aria-label={tab.label}
									className={cn(
										"shrink-0",
										"h-8 w-8",
										tab.id !== activeTab.id && "text-muted-foreground",
									)}
								>
									{tab.icon}
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">{tab.label}</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="border-b px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold">{activeTab.label}</span>
						<span className="text-muted-foreground truncate text-xs">
							{element.name}
						</span>
					</div>
					{activeBackgroundItems.length > 0 ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{activeBackgroundItems.map((item) => (
								<div
									key={item.key}
									className={cn(
										"min-w-0 rounded-lg border px-2.5 py-2 text-xs",
										item.tone === "emerald"
											? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
											: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
									)}
								>
									<div className="font-semibold">
										{item.title}
										{typeof item.progress === "number"
											? ` ${item.progress}%`
											: " running"}
									</div>
									<div className="truncate">
										{item.message ?? "Working in background..."}
									</div>
								</div>
							))}
						</div>
					) : null}
				</div>
				<ScrollArea className="flex-1 scrollbar-hidden">
					{activeTab.content({ trackId: track.id })}
				</ScrollArea>
			</div>
		</div>
	);
}
