import type {
	HybridTaskType,
	TaskDestinationDecision,
} from "@/lib/hybrid/types";

export async function checkTaskDestination({
	taskType,
	userCredits,
	deductCredit,
}: {
	taskType: HybridTaskType;
	userCredits: number;
	deductCredit?: (amount: number) => Promise<void> | void;
}): Promise<TaskDestinationDecision> {
	if (taskType === "basic_blur") {
		return {
			destination: "local",
			taskType,
			creditCost: 0,
			remainingCredits: Math.max(0, userCredits),
		};
	}

	if (taskType === "ai_clean") {
		if (userCredits <= 0) {
			return {
				destination: "blocked",
				taskType,
				creditCost: 1,
				remainingCredits: 0,
				reason: "No AI credits remaining. Prompt the user to buy credits.",
			};
		}

		await deductCredit?.(1);

		return {
			destination: "cloud",
			taskType,
			creditCost: 1,
			remainingCredits: userCredits - 1,
		};
	}

	return {
		destination: "blocked",
		taskType,
		creditCost: 0,
		remainingCredits: Math.max(0, userCredits),
		reason: `Unsupported hybrid task: ${String(taskType)}`,
	};
}
