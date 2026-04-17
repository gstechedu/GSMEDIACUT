export const PROJECT_STATE_VERSION = 1;

export type HybridTaskType = "basic_blur" | "ai_clean";

export type TaskDestination = "local" | "cloud" | "blocked";

export interface WatermarkArea {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ProxyAssetState {
	assetId: string;
	status: "pending" | "ready" | "failed";
	localPath?: string;
	playbackUrl?: string;
	width?: number;
	height?: number;
	error?: string;
	updatedAt: string;
}

export interface BackgroundJobState {
	id: string;
	taskType: HybridTaskType;
	status:
		| "queued"
		| "submitting"
		| "processing"
		| "completed"
		| "failed"
		| "blocked";
	creditCost: number;
	remoteJobId?: string;
	resultUrl?: string;
	error?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProcessingTaskState {
	taskType: HybridTaskType;
	assetId?: string;
	settings: Record<string, unknown>;
}

export interface ProjectState {
	version: number;
	aiMode: boolean;
	watermarkArea: WatermarkArea | null;
	pendingTasks: ProcessingTaskState[];
	proxyAssets: Record<string, ProxyAssetState>;
	backgroundJobs: BackgroundJobState[];
}

export interface TaskDestinationDecision {
	destination: TaskDestination;
	taskType: HybridTaskType;
	creditCost: number;
	remainingCredits: number;
	reason?: string;
}
