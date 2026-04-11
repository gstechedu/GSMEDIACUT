"use client";

import { ArrowRight, CheckCircle2, Clock3, WandSparkles } from "lucide-react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { STUDIO_FEATURE_CARDS } from "@/data/gsm-studio";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";
import { cn } from "@/utils/ui";

export function StudioView() {
	const { setActiveTab } = useAssetsPanelStore();

	return (
		<PanelView title="Studio">
			<div className="flex flex-col gap-4">
				<div className="rounded-xl border bg-linear-to-br from-sky-500/12 via-cyan-500/8 to-background p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-2">
							<div className="inline-flex items-center gap-2 rounded-full bg-sky-500/12 px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.18em] text-sky-600 uppercase">
								<WandSparkles className="size-3.5" />
								GSMEDIACUT
							</div>
							<div>
								<h2 className="text-base font-semibold">Creator workflow hub</h2>
								<p className="text-muted-foreground text-sm">
									OpenCut already covers the editor core. Use this hub to jump
									into captions, title styles, stickers, audio, transitions, and
									export.
								</p>
							</div>
						</div>
						<div className="hidden rounded-xl border bg-background/80 px-3 py-2 text-right text-xs min-[920px]:block">
							<div className="font-medium">Offline-first build</div>
							<div className="text-muted-foreground">
								Web editor now, desktop/mobile wrappers next
							</div>
						</div>
					</div>
				</div>

				<div className="grid gap-3">
					{STUDIO_FEATURE_CARDS.map((card) => (
						<div key={card.id} className="rounded-xl border bg-background p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<h3 className="text-sm font-semibold">{card.title}</h3>
										<StatusBadge status={card.status} />
									</div>
									<p className="text-muted-foreground text-sm">
										{card.description}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									className="shrink-0"
									onClick={() => setActiveTab(card.tab)}
								>
									Open
									<ArrowRight className="size-4" />
								</Button>
							</div>
						</div>
					))}
				</div>

				<div className="rounded-xl border bg-accent/30 p-3">
					<h3 className="text-sm font-semibold">Build sequence</h3>
					<p className="text-muted-foreground mt-1 text-sm">
						Run the editor, confirm media import and export, then wire in Lottie
						playback and shader-based transitions on top of the existing preview
						and renderer services.
					</p>
				</div>
			</div>
		</PanelView>
	);
}

function StatusBadge({
	status,
}: {
	status: "ready" | "in-progress" | "planned";
}) {
	const config = {
		ready: {
			label: "Ready",
			icon: CheckCircle2,
			className: "border-emerald-200 bg-emerald-500/10 text-emerald-700",
		},
		"in-progress": {
			label: "Wiring",
			icon: Clock3,
			className: "border-sky-200 bg-sky-500/10 text-sky-700",
		},
		planned: {
			label: "Planned",
			icon: Clock3,
			className: "border-border bg-muted text-muted-foreground",
		},
	}[status];

	const Icon = config.icon;

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium",
				config.className,
			)}
		>
			<Icon className="size-3.5" />
			{config.label}
		</span>
	);
}
