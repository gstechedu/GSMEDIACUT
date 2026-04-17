import { EventEmitter } from "node:events";

export type WatermarkProgressPhase =
	| "idle"
	| "preparing"
	| "uploading"
	| "queued"
	| "processing"
	| "downloading"
	| "importing"
	| "cleaning"
	| "completed"
	| "failed";

export type WatermarkProgressState = {
	jobId: string;
	phase: WatermarkProgressPhase;
	progress: number;
	status: "running" | "completed" | "failed";
	message?: string;
	detail?: string;
	updatedAt: number;
};

type WatermarkProgressStore = {
	emitter: EventEmitter;
	jobs: Map<string, WatermarkProgressState>;
	cleanupTimers: Map<string, NodeJS.Timeout>;
};

const STORE_KEY = "__gsm_watermark_progress_store__";

function getStore(): WatermarkProgressStore {
	const globalStore = globalThis as typeof globalThis & {
		[STORE_KEY]?: WatermarkProgressStore;
	};

	if (!globalStore[STORE_KEY]) {
		globalStore[STORE_KEY] = {
			emitter: new EventEmitter(),
			jobs: new Map(),
			cleanupTimers: new Map(),
		};
	}

	return globalStore[STORE_KEY];
}

function scheduleCleanup(jobId: string) {
	const store = getStore();
	const existing = store.cleanupTimers.get(jobId);
	if (existing) {
		clearTimeout(existing);
	}

	const timer = setTimeout(
		() => {
			store.jobs.delete(jobId);
			store.cleanupTimers.delete(jobId);
		},
		1000 * 60 * 10,
	);

	store.cleanupTimers.set(jobId, timer);
}

function publish(next: WatermarkProgressState) {
	const store = getStore();
	store.jobs.set(next.jobId, next);
	store.emitter.emit(next.jobId, next);

	if (next.status !== "running") {
		scheduleCleanup(next.jobId);
	}
}

export function initWatermarkProgress(jobId: string) {
	const state: WatermarkProgressState = {
		jobId,
		phase: "preparing",
		progress: 1,
		status: "running",
		message: "Preparing clip",
		detail: "Checking the selected clip and building the processing request.",
		updatedAt: Date.now(),
	};

	publish(state);
	return state;
}

export function updateWatermarkProgress(
	jobId: string,
	patch: Partial<Omit<WatermarkProgressState, "jobId" | "updatedAt">>,
) {
	const store = getStore();
	const previous =
		store.jobs.get(jobId) ??
		({
			jobId,
			phase: "idle",
			progress: 0,
			status: "running",
			updatedAt: Date.now(),
		} satisfies WatermarkProgressState);

	const next: WatermarkProgressState = {
		...previous,
		...patch,
		jobId,
		progress: Math.max(
			0,
			Math.min(100, Math.round(patch.progress ?? previous.progress)),
		),
		updatedAt: Date.now(),
	};

	publish(next);
	return next;
}

export function completeWatermarkProgress(
	jobId: string,
	patch: Partial<
		Omit<WatermarkProgressState, "jobId" | "updatedAt" | "status">
	> = {},
) {
	return updateWatermarkProgress(jobId, {
		...patch,
		phase: patch.phase ?? "completed",
		progress: patch.progress ?? 100,
		status: "completed",
	});
}

export function failWatermarkProgress(
	jobId: string,
	message: string,
	detail?: string,
) {
	return updateWatermarkProgress(jobId, {
		phase: "failed",
		progress: 100,
		status: "failed",
		message,
		detail,
	});
}

export function getWatermarkProgress(jobId: string) {
	return getStore().jobs.get(jobId) ?? null;
}

export function subscribeWatermarkProgress(
	jobId: string,
	listener: (state: WatermarkProgressState) => void,
) {
	const store = getStore();
	store.emitter.on(jobId, listener);

	return () => {
		store.emitter.off(jobId, listener);
	};
}
