import {
	PROJECT_STATE_VERSION,
	type BackgroundJobState,
	type ProcessingTaskState,
	type ProjectState,
	type ProxyAssetState,
	type WatermarkArea,
} from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

export function createDefaultProjectState(): ProjectState {
	return {
		version: PROJECT_STATE_VERSION,
		aiMode: false,
		watermarkArea: null,
		pendingTasks: [],
		proxyAssets: {},
		backgroundJobs: [],
	};
}

export function normalizeProjectState(
	projectState: Partial<ProjectState> | null | undefined,
): ProjectState {
	const fallback = createDefaultProjectState();

	return {
		version:
			typeof projectState?.version === "number"
				? projectState.version
				: fallback.version,
		aiMode:
			typeof projectState?.aiMode === "boolean"
				? projectState.aiMode
				: fallback.aiMode,
		watermarkArea: normalizeWatermarkArea(projectState?.watermarkArea),
		pendingTasks: Array.isArray(projectState?.pendingTasks)
			? projectState.pendingTasks.filter(isProcessingTaskState)
			: fallback.pendingTasks,
		proxyAssets: normalizeProxyAssets(projectState?.proxyAssets),
		backgroundJobs: Array.isArray(projectState?.backgroundJobs)
			? projectState.backgroundJobs.filter(isBackgroundJobState)
			: fallback.backgroundJobs,
	};
}

export function updateProjectStateMetadata({
	projectState,
	watermarkArea,
	aiMode,
}: {
	projectState: ProjectState;
	watermarkArea?: WatermarkArea | null;
	aiMode?: boolean;
}): ProjectState {
	return {
		...projectState,
		...(watermarkArea !== undefined ? { watermarkArea } : {}),
		...(aiMode !== undefined ? { aiMode } : {}),
	};
}

export function queueProjectTask({
	projectState,
	task,
}: {
	projectState: ProjectState;
	task: ProcessingTaskState;
}): ProjectState {
	return {
		...projectState,
		pendingTasks: [...projectState.pendingTasks, task],
	};
}

export function upsertProxyAsset({
	projectState,
	proxyAsset,
}: {
	projectState: ProjectState;
	proxyAsset: Omit<ProxyAssetState, "updatedAt"> & { updatedAt?: string };
}): ProjectState {
	return {
		...projectState,
		proxyAssets: {
			...projectState.proxyAssets,
			[proxyAsset.assetId]: {
				...projectState.proxyAssets[proxyAsset.assetId],
				...proxyAsset,
				updatedAt: proxyAsset.updatedAt ?? nowIso(),
			},
		},
	};
}

export function upsertBackgroundJob({
	projectState,
	job,
}: {
	projectState: ProjectState;
	job: Omit<BackgroundJobState, "createdAt" | "updatedAt"> &
		Partial<Pick<BackgroundJobState, "createdAt" | "updatedAt">>;
}): ProjectState {
	const existing = projectState.backgroundJobs.find(
		(item) => item.id === job.id,
	);
	const nextJob: BackgroundJobState = {
		createdAt: existing?.createdAt ?? job.createdAt ?? nowIso(),
		updatedAt: job.updatedAt ?? nowIso(),
		...existing,
		...job,
	};

	return {
		...projectState,
		backgroundJobs: [
			...projectState.backgroundJobs.filter((item) => item.id !== job.id),
			nextJob,
		],
	};
}

function normalizeWatermarkArea(value: unknown): WatermarkArea | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Partial<WatermarkArea>;
	if (
		typeof candidate.x !== "number" ||
		typeof candidate.y !== "number" ||
		typeof candidate.w !== "number" ||
		typeof candidate.h !== "number"
	) {
		return null;
	}

	return {
		x: candidate.x,
		y: candidate.y,
		w: candidate.w,
		h: candidate.h,
	};
}

function normalizeProxyAssets(
	value: ProjectState["proxyAssets"] | undefined,
): ProjectState["proxyAssets"] {
	if (!value || typeof value !== "object") {
		return {};
	}

	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => isProxyAssetState(item)),
	);
}

function isProcessingTaskState(value: unknown): value is ProcessingTaskState {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<ProcessingTaskState>;
	return (
		(candidate.taskType === "basic_blur" ||
			candidate.taskType === "ai_clean") &&
		typeof candidate.settings === "object" &&
		candidate.settings !== null
	);
}

function isProxyAssetState(value: unknown): value is ProxyAssetState {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<ProxyAssetState>;
	return (
		typeof candidate.assetId === "string" &&
		(candidate.status === "pending" ||
			candidate.status === "ready" ||
			candidate.status === "failed") &&
		typeof candidate.updatedAt === "string"
	);
}

function isBackgroundJobState(value: unknown): value is BackgroundJobState {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<BackgroundJobState>;
	return (
		typeof candidate.id === "string" &&
		(candidate.taskType === "basic_blur" ||
			candidate.taskType === "ai_clean") &&
		typeof candidate.creditCost === "number" &&
		typeof candidate.createdAt === "string" &&
		typeof candidate.updatedAt === "string"
	);
}
