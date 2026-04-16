import { webEnv } from "@/lib/env/web";

type RunpodJobRequest = {
	input: Record<string, unknown>;
	webhook?: string;
};

export function hasRunpodConfig() {
	return Boolean(webEnv.RUNPOD_API_KEY && webEnv.RUNPOD_ENDPOINT_ID);
}

function requireRunpodEnv() {
	if (!hasRunpodConfig()) {
		throw new Error(
			"Missing Runpod configuration. Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID.",
		);
	}

	return {
		apiKey: webEnv.RUNPOD_API_KEY,
		endpointId: webEnv.RUNPOD_ENDPOINT_ID,
		apiBaseUrl: webEnv.RUNPOD_API_BASE_URL,
	};
}

async function runpodFetch<T>({
	path,
	method,
	body,
}: {
	path: string;
	method: "GET" | "POST";
	body?: unknown;
}): Promise<T> {
	const env = requireRunpodEnv();
	const response = await fetch(`${env.apiBaseUrl}/${env.endpointId}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${env.apiKey}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
		cache: "no-store",
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			errorText || `Runpod request failed with ${response.status}`,
		);
	}

	return response.json() as Promise<T>;
}

export async function submitRunpodJob({ input, webhook }: RunpodJobRequest) {
	return runpodFetch<{
		id: string;
		status?: string;
		delayTime?: number;
		executionTime?: number;
		output?: unknown;
	}>({
		path: "/run",
		method: "POST",
		body: webhook ? { input, webhook } : { input },
	});
}

export async function submitRunpodSyncJob({
	input,
	webhook,
}: RunpodJobRequest) {
	return runpodFetch<{
		id: string;
		status?: string;
		output?: unknown;
	}>({
		path: "/runsync",
		method: "POST",
		body: webhook ? { input, webhook } : { input },
	});
}

export async function getRunpodJobStatus({ jobId }: { jobId: string }) {
	return runpodFetch<{
		id: string;
		status: string;
		output?: unknown;
		delayTime?: number;
		executionTime?: number;
		error?: string;
	}>({
		path: `/status/${jobId}`,
		method: "GET",
	});
}
