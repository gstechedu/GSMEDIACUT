"use client";

import { useEffect, useMemo, useState } from "react";
import {
	DEFAULT_VOICE_MODEL_OPTIONS,
	mergeVoiceModelOptions,
} from "@/lib/voice-models";

type VoiceModelsResponse = {
	models?: string[];
};

export function useVoiceModelOptions() {
	const [remoteModels, setRemoteModels] = useState<string[]>([]);

	useEffect(() => {
		let cancelled = false;

		void fetch("/api/voice/models", {
			method: "GET",
			cache: "no-store",
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Failed to load voice models");
				}
				return (await response.json()) as VoiceModelsResponse;
			})
			.then((payload) => {
				if (cancelled) {
					return;
				}
				setRemoteModels(
					Array.isArray(payload.models) ? payload.models.filter(Boolean) : [],
				);
			})
			.catch(() => {
				if (!cancelled) {
					setRemoteModels([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	return useMemo(
		() =>
			mergeVoiceModelOptions([
				...DEFAULT_VOICE_MODEL_OPTIONS,
				...remoteModels,
			]),
		[remoteModels],
	);
}
