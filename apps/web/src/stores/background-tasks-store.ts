import { create } from "zustand";

export type BackgroundTaskStatus = "running" | "completed" | "failed";

export type BackgroundTask = {
	key: string;
	title: string;
	tabId?: string;
	elementId?: string;
	trackId?: string;
	assetId?: string;
	status: BackgroundTaskStatus;
	message?: string;
	detail?: string;
	progress?: number | null;
	startedAt: number;
	updatedAt: number;
	metadata?: Record<string, unknown>;
};

type StartTaskInput = Omit<
	BackgroundTask,
	"status" | "startedAt" | "updatedAt"
>;

type UpdateTaskPatch = Partial<
	Omit<BackgroundTask, "key" | "title" | "startedAt" | "updatedAt">
>;

type BackgroundTasksState = {
	tasksByKey: Record<string, BackgroundTask>;
	startTask: (task: StartTaskInput) => void;
	updateTask: (key: string, patch: UpdateTaskPatch) => void;
	completeTask: (key: string, patch?: UpdateTaskPatch) => void;
	failTask: (key: string, message: string, detail?: string) => void;
	clearTask: (key: string) => void;
};

function clampProgress(value: number | null | undefined) {
	if (value === null || typeof value === "undefined") {
		return null;
	}
	if (Number.isNaN(value)) {
		return null;
	}

	return Math.max(0, Math.min(100, Math.round(value)));
}

function updateMatchingTask(
	state: BackgroundTasksState,
	key: string,
	createNext: (task: BackgroundTask) => BackgroundTask,
) {
	const currentTask = state.tasksByKey[key];
	if (!currentTask) {
		return state;
	}

	return {
		tasksByKey: {
			...state.tasksByKey,
			[key]: createNext(currentTask),
		},
	};
}

export const useBackgroundTasksStore = create<BackgroundTasksState>()(
	(set) => ({
		tasksByKey: {},
		startTask: (task) =>
			set((state) => ({
				tasksByKey: {
					...state.tasksByKey,
					[task.key]: {
						...task,
						status: "running",
						progress: clampProgress(task.progress),
						startedAt: Date.now(),
						updatedAt: Date.now(),
					},
				},
			})),
		updateTask: (key, patch) =>
			set((state) =>
				updateMatchingTask(state, key, (currentTask) => ({
					...currentTask,
					...patch,
					progress: clampProgress(patch.progress ?? currentTask.progress),
					updatedAt: Date.now(),
				})),
			),
		completeTask: (key, patch = {}) =>
			set((state) =>
				updateMatchingTask(state, key, (currentTask) => ({
					...currentTask,
					...patch,
					status: "completed",
					progress: clampProgress(patch.progress ?? currentTask.progress),
					updatedAt: Date.now(),
				})),
			),
		failTask: (key, message, detail) =>
			set((state) =>
				updateMatchingTask(state, key, (currentTask) => ({
					...currentTask,
					status: "failed",
					message,
					detail,
					progress: clampProgress(currentTask.progress),
					updatedAt: Date.now(),
				})),
			),
		clearTask: (key) =>
			set((state) => {
				if (!(key in state.tasksByKey)) {
					return state;
				}

				const nextTasks = { ...state.tasksByKey };
				delete nextTasks[key];
				return { tasksByKey: nextTasks };
			}),
	}),
);
