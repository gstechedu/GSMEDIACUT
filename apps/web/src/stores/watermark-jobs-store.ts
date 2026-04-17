import { create } from "zustand";

export type WatermarkJobEngine = "fast" | "ai";

export type WatermarkJobPhase =
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

export type WatermarkJobStatus = "running" | "completed" | "failed";

export type WatermarkClientJob = {
	assetId: string;
	assetName: string;
	jobId: string;
	engine: WatermarkJobEngine;
	elementId: string;
	trackId: string;
	status: WatermarkJobStatus;
	phase: WatermarkJobPhase;
	progress: number;
	message?: string;
	detail?: string;
	outputName?: string | null;
	startedAt: number;
	updatedAt: number;
};

type UpdateJobPatch = Partial<
	Omit<
		WatermarkClientJob,
		| "assetId"
		| "assetName"
		| "jobId"
		| "engine"
		| "elementId"
		| "trackId"
		| "startedAt"
		| "updatedAt"
	>
>;

type StartJobInput = Omit<
	WatermarkClientJob,
	"status" | "startedAt" | "updatedAt"
>;

type WatermarkJobsState = {
	dialogOpen: boolean;
	jobsByAssetId: Record<string, WatermarkClientJob>;
	openPopup: () => void;
	setDialogOpen: (open: boolean) => void;
	startJob: (job: StartJobInput) => void;
	updateJob: (assetId: string, jobId: string, patch: UpdateJobPatch) => void;
	completeJob: (
		assetId: string,
		jobId: string,
		patch?: Omit<UpdateJobPatch, "status" | "phase">,
	) => void;
	failJob: (
		assetId: string,
		jobId: string,
		message: string,
		detail?: string,
	) => void;
};

function clampProgress(value: number | undefined) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return 0;
	}

	return Math.max(0, Math.min(100, Math.round(value)));
}

function updateMatchingJob(
	state: WatermarkJobsState,
	assetId: string,
	jobId: string,
	createNext: (job: WatermarkClientJob) => WatermarkClientJob,
) {
	const currentJob = state.jobsByAssetId[assetId];
	if (!currentJob || currentJob.jobId !== jobId) {
		return state;
	}

	return {
		jobsByAssetId: {
			...state.jobsByAssetId,
			[assetId]: createNext(currentJob),
		},
	};
}

export const useWatermarkJobsStore = create<WatermarkJobsState>()((set) => ({
	dialogOpen: true,
	jobsByAssetId: {},
	openPopup: () => set({ dialogOpen: true }),
	setDialogOpen: (open) => set({ dialogOpen: open }),
	startJob: (job) =>
		set((state) => ({
			dialogOpen: true,
			jobsByAssetId: {
				...state.jobsByAssetId,
				[job.assetId]: {
					...job,
					status: "running",
					progress: clampProgress(job.progress),
					startedAt: Date.now(),
					updatedAt: Date.now(),
				},
			},
		})),
	updateJob: (assetId, jobId, patch) =>
		set((state) =>
			updateMatchingJob(state, assetId, jobId, (currentJob) => ({
				...currentJob,
				...patch,
				progress: clampProgress(patch.progress ?? currentJob.progress),
				updatedAt: Date.now(),
			})),
		),
	completeJob: (assetId, jobId, patch = {}) =>
		set((state) =>
			updateMatchingJob(state, assetId, jobId, (currentJob) => ({
				...currentJob,
				...patch,
				status: "completed",
				phase: "completed",
				progress: clampProgress(patch.progress ?? 100),
				updatedAt: Date.now(),
			})),
		),
	failJob: (assetId, jobId, message, detail) =>
		set((state) =>
			updateMatchingJob(state, assetId, jobId, (currentJob) => ({
				...currentJob,
				status: "failed",
				phase: "failed",
				progress: 100,
				message,
				detail,
				updatedAt: Date.now(),
			})),
		),
}));
