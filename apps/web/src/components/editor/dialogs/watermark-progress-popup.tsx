"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useWatermarkJobsStore } from "@/stores/watermark-jobs-store";

function engineLabel(engine: "fast" | "ai") {
	switch (engine) {
		case "ai":
			return "AI";
		default:
			return "Fast";
	}
}

export function WatermarkProgressPopup() {
	const dialogOpen = useWatermarkJobsStore((state) => state.dialogOpen);
	const setDialogOpen = useWatermarkJobsStore((state) => state.setDialogOpen);
	const jobsByAssetId = useWatermarkJobsStore((state) => state.jobsByAssetId);
	const runningJobs = useMemo(
		() =>
			Object.values(jobsByAssetId)
				.filter((job) => job.status === "running")
				.sort((left, right) => right.updatedAt - left.updatedAt),
		[jobsByAssetId],
	);

	if (runningJobs.length === 0) {
		return null;
	}

	if (!dialogOpen) {
		return (
			<div className="pointer-events-none fixed right-4 bottom-4 z-250">
				<Button
					type="button"
					onClick={() => setDialogOpen(true)}
					className="pointer-events-auto h-auto rounded-2xl px-4 py-3 text-left shadow-lg"
				>
					{runningJobs.length === 1
						? "Watermark processing is still running"
						: `${runningJobs.length} watermark jobs are still running`}
				</Button>
			</div>
		);
	}

	return (
		<div className="pointer-events-none fixed right-4 bottom-4 z-250 w-full max-w-sm px-4 sm:px-0">
			<div className="pointer-events-auto rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur">
				<div className="flex items-start justify-between gap-3 border-b px-4 py-3">
					<div>
						<div className="text-sm font-semibold">
							Watermark processing in background
						</div>
						<div className="text-muted-foreground mt-1 text-xs">
							Keep editing if you want, but do not run watermark removal again
							on the same clip until this finishes.
						</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setDialogOpen(false)}
						className="shrink-0"
					>
						Hide
					</Button>
				</div>

				<div className="space-y-3 px-4 py-3">
					{runningJobs.map((job) => (
						<div
							key={job.jobId}
							className="rounded-xl border border-border/70 bg-accent/20 px-3 py-3"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="truncate text-sm font-medium">
										{job.assetName}
									</div>
									<div className="text-muted-foreground mt-1 text-xs">
										{engineLabel(job.engine)} engine
									</div>
								</div>
								<div className="text-sm font-semibold">{job.progress}%</div>
							</div>

							<div className="mt-3 h-2 overflow-hidden rounded-full bg-accent">
								<div
									className="bg-primary h-full transition-[width] duration-500 ease-out"
									style={{ width: `${job.progress}%` }}
								/>
							</div>

							<div className="mt-3 text-sm font-medium">
								{job.message ?? "Processing clip"}
							</div>
							<div className="text-muted-foreground mt-1 text-xs">
								{job.detail ?? "GSMEDIACUT is still working on this clip."}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
