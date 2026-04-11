"use client";

import { ArrowRightLeft, Clapperboard, Sparkles } from "lucide-react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { TRANSITION_PRESETS } from "@/data/gsm-studio";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";

export function TransitionsView() {
	const { setActiveTab } = useAssetsPanelStore();

	return (
		<PanelView title="Transitions">
			<div className="flex flex-col gap-4">
				<div className="rounded-xl border bg-linear-to-br from-fuchsia-500/10 via-orange-500/10 to-background p-4">
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-background/80 p-2">
							<ArrowRightLeft className="size-5" />
						</div>
						<div>
							<h2 className="text-sm font-semibold">GL-transition preset board</h2>
							<p className="text-muted-foreground mt-1 text-sm">
								These presets are mapped from the `gl-transitions` catalog so
								you can design the editor workflow before the renderer hookup is
								finished.
							</p>
						</div>
					</div>
				</div>

				<div className="grid gap-3">
					{TRANSITION_PRESETS.map((preset) => (
						<div key={preset.id} className="rounded-xl border bg-background p-3">
							<div className="flex items-start justify-between gap-3">
								<div>
									<div className="flex items-center gap-2">
										<h3 className="text-sm font-semibold">{preset.name}</h3>
										<span className="rounded-full bg-accent px-2 py-0.5 text-[0.68rem] font-medium">
											{preset.mood}
										</span>
									</div>
									<p className="text-muted-foreground mt-1 text-sm">
										{preset.description}
									</p>
									<p className="text-muted-foreground mt-2 text-xs">
										Source family: {preset.family}
									</p>
								</div>
								<div className="rounded-lg border bg-accent/40 px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Catalog
								</div>
							</div>
						</div>
					))}
				</div>

				<div className="grid gap-3 min-[860px]:grid-cols-2">
					<div className="rounded-xl border p-3">
						<div className="flex items-center gap-2 text-sm font-semibold">
							<Clapperboard className="size-4" />
							Current workflow
						</div>
						<p className="text-muted-foreground mt-2 text-sm">
							Use the timeline for clip order, then open Effects for clip-level
							stylization while transition export wiring is being added.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => setActiveTab("effects")}
						>
							Open effects
						</Button>
					</div>
					<div className="rounded-xl border p-3">
						<div className="flex items-center gap-2 text-sm font-semibold">
							<Sparkles className="size-4" />
							Next integration step
						</div>
						<p className="text-muted-foreground mt-2 text-sm">
							Bind selected presets to renderer transition metadata, then feed
							that into the export pipeline so adjacent clips render with the
							chosen shader.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => setActiveTab("captions")}
						>
							Open captions
						</Button>
					</div>
				</div>
			</div>
		</PanelView>
	);
}
