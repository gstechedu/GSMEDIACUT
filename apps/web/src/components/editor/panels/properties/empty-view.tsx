import { Button } from "@/components/ui/button";
import { useEditor } from "@/hooks/use-editor";
import { HugeiconsIcon } from "@hugeicons/react";
import { MouseLeftClickIcon, Settings05Icon } from "@hugeicons/core-free-icons";
import { usePropertiesStore } from "./stores/properties-store";

export function EmptyView() {
	const editor = useEditor();
	const activeScene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const setActiveTab = usePropertiesStore((state) => state.setActiveTab);

	const firstVideoElement =
		activeScene?.tracks.main.elements.find(
			(element) => element.type === "video",
		) ??
		activeScene?.tracks.overlay
			.flatMap((track) =>
				track.elements.map((element) => ({ trackId: track.id, element })),
			)
			.find(({ element }) => element.type === "video");

	const handleSelectVideo = () => {
		if (!activeScene || !firstVideoElement) {
			return;
		}

		setActiveTab("video", "watermark");

		if ("trackId" in firstVideoElement) {
			editor.selection.setSelectedElements({
				elements: [
					{
						trackId: firstVideoElement.trackId,
						elementId: firstVideoElement.element.id,
					},
				],
			});
			return;
		}

		editor.selection.setSelectedElements({
			elements: [
				{
					trackId: activeScene.tracks.main.id,
					elementId: firstVideoElement.id,
				},
			],
		});
	};

	return (
		<div className="bg-background flex h-full flex-col items-center justify-center gap-3 p-4">
			<HugeiconsIcon
				icon={Settings05Icon}
				className="text-muted-foreground/75 size-10"
				strokeWidth={1}
			/>
			<div className="flex flex-col gap-2 text-center">
				<p className="text-lg font-medium ">It's empty here</p>
				<p className="text-muted-foreground text-sm text-balance">
					Select a clip on the timeline to edit its properties. Watermark tools
					only appear after a video clip is selected.
				</p>
			</div>
			{firstVideoElement ? (
				<Button variant="outline" size="sm" onClick={handleSelectVideo}>
					<HugeiconsIcon icon={MouseLeftClickIcon} className="mr-1 size-4" />
					Select Video Clip
				</Button>
			) : null}
		</div>
	);
}
