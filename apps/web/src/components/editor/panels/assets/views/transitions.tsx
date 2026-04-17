"use client";

import { ArrowRightLeft, MoveRight } from "lucide-react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";

export function TransitionsView() {
	const editor = useEditor();
	const { selectedElements } = useElementSelection();
	const { setActiveTab } = useAssetsPanelStore();
	const elementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});
	const selectedElementWithTrack =
		selectedElements.length === 1 ? (elementsWithTracks[0] ?? null) : null;
	const selectedClipLabel = selectedElementWithTrack
		? "name" in selectedElementWithTrack.element
			? selectedElementWithTrack.element.name
			: selectedElementWithTrack.element.type
		: "All presets";

	return (
		<PanelView
			title="Transitions"
			contentClassName="px-0 pb-3"
			scrollClassName="pb-3"
		>
			<div className="flex flex-col gap-4 px-2">
				<div className="rounded-xl border bg-[linear-gradient(135deg,rgba(34,197,94,0.10),rgba(59,130,246,0.08),transparent)] p-4">
					<div className="flex flex-col gap-4 min-[980px]:flex-row min-[980px]:items-end min-[980px]:justify-between">
						<div className="space-y-2">
							<div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
								<ArrowRightLeft className="size-3.5" />
								Transition Board
							</div>
							<div>
								<h2 className="text-base font-semibold">
									Transition controls now live with clip properties
								</h2>
								<p className="text-muted-foreground mt-1 max-w-3xl text-sm">
									Select an audio clip or a video clip with sound, then open the
									new Transition tab under the Audio icon in the properties
									panel to browse the preset matrix.
								</p>
							</div>
						</div>

						<div className="grid gap-2 min-[980px]:min-w-[18rem]">
							<Button
								variant="secondary"
								size="sm"
								className="justify-between"
								onClick={() => setActiveTab("effects")}
							>
								Open Effects
								<MoveRight className="size-4" />
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="justify-between"
								onClick={() => setActiveTab("captions")}
							>
								Open Captions
								<MoveRight className="size-4" />
							</Button>
						</div>
					</div>
				</div>

				<div className="grid gap-3 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
					<div className="rounded-xl border bg-background p-4">
						<div className="text-sm font-semibold">Transition Flow</div>
						<div className="text-muted-foreground mt-1 text-sm">
							Selected source:{" "}
							<span className="text-foreground">{selectedClipLabel}</span>
						</div>
						<div className="mt-3 grid gap-2 text-sm min-[980px]:grid-cols-3">
							<div className="rounded-lg border bg-accent/20 px-3 py-2">
								<div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Step 1
								</div>
								<div className="mt-1 font-medium">Select audio clip</div>
							</div>
							<div className="rounded-lg border bg-accent/20 px-3 py-2">
								<div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Step 2
								</div>
								<div className="mt-1 font-medium">Open transition tab</div>
							</div>
							<div className="rounded-lg border bg-accent/20 px-3 py-2">
								<div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Step 3
								</div>
								<div className="mt-1 font-medium">Pick preset flow</div>
							</div>
						</div>
					</div>

					<div className="rounded-xl border bg-background p-4">
						<div className="text-sm font-semibold">Quick Actions</div>
						<div className="mt-3 grid gap-2">
							<Button
								variant="secondary"
								size="sm"
								className="justify-between"
								onClick={() => setActiveTab("effects")}
							>
								Open Effects
								<MoveRight className="size-4" />
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="justify-between"
								onClick={() => setActiveTab("captions")}
							>
								Open Captions
								<MoveRight className="size-4" />
							</Button>
						</div>
					</div>
				</div>
			</div>
		</PanelView>
	);
}
