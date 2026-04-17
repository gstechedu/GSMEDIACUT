import { generateUUID } from "@/utils/id";
import type { BackgroundJobState, HybridTaskType } from "@/lib/hybrid/types";

type RunpodStatusResponse = {
	id: string;
	status: string;
	output?: unknown;
	error?: string;
};

type Listener = (job: BackgroundJobState) => void;

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export class BackgroundExportManager {
	private jobs = new Map<string, BackgroundJobState>();
	private listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getJobs(): BackgroundJobState[] {
		return Array.from(this.jobs.values());
	}

	async enqueueCloudTask({
		taskType,
		input,
		creditCost = 1,
	}: {
		taskType: HybridTaskType;
		input: Record<string, unknown>;
		creditCost?: number;
	}): Promise<BackgroundJobState> {
		const job: BackgroundJobState = {
			id: generateUUID(),
			taskType,
			status: "queued",
			creditCost,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		this.setJob(job);
		void this.runCloudTask({ localJobId: job.id, input });
		return job;
	}

	private async runCloudTask({
		localJobId,
		input,
	}: {
		localJobId: string;
		input: Record<string, unknown>;
	}): Promise<void> {
		try {
			this.patchJob(localJobId, { status: "submitting" });

			const submitResponse = await fetch("/api/cloud/runpod/jobs", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					mode: "async",
					input,
				}),
			});

			if (!submitResponse.ok) {
				throw new Error(await submitResponse.text());
			}

			const submitted = (await submitResponse.json()) as { id: string };
			this.patchJob(localJobId, {
				status: "processing",
				remoteJobId: submitted.id,
			});

			await this.pollUntilComplete({ localJobId, remoteJobId: submitted.id });
		} catch (error) {
			this.patchJob(localJobId, {
				status: "failed",
				error:
					error instanceof Error ? error.message : "Background export failed.",
			});
		}
	}

	private async pollUntilComplete({
		localJobId,
		remoteJobId,
	}: {
		localJobId: string;
		remoteJobId: string;
	}): Promise<void> {
		for (;;) {
			const response = await fetch(`/api/cloud/runpod/jobs/${remoteJobId}`, {
				cache: "no-store",
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as RunpodStatusResponse;
			const nextStatus = mapRunpodStatus(payload.status);
			this.patchJob(localJobId, {
				status: nextStatus,
				error: payload.error,
			});

			if (TERMINAL_STATUSES.has(payload.status)) {
				return;
			}

			await delay(2000);
		}
	}

	private setJob(job: BackgroundJobState): void {
		this.jobs.set(job.id, job);
		this.emit(job);
	}

	private patchJob(
		jobId: string,
		patch: Partial<Omit<BackgroundJobState, "id" | "createdAt">>,
	): void {
		const current = this.jobs.get(jobId);
		if (!current) {
			return;
		}

		const next: BackgroundJobState = {
			...current,
			...patch,
			updatedAt: new Date().toISOString(),
		};
		this.jobs.set(jobId, next);
		this.emit(next);
	}

	private emit(job: BackgroundJobState): void {
		for (const listener of this.listeners) {
			listener(job);
		}
	}
}

function mapRunpodStatus(status: string): BackgroundJobState["status"] {
	switch (status) {
		case "IN_QUEUE":
		case "IN_PROGRESS":
			return "processing";
		case "COMPLETED":
			return "completed";
		case "FAILED":
		case "CANCELLED":
			return "failed";
		default:
			return "queued";
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
}
