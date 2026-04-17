import { hasKeyframesForPath } from "@/lib/animation/keyframe-query";
import { resolveNumberAtTime } from "@/lib/animation/resolve";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "./audio-constants";
import type { TimelineElement } from "./types";
const DEFAULT_STEP_SECONDS = 1 / 60;

export type AudioCapableElement = Extract<
	TimelineElement,
	{ type: "audio" | "video" }
>;

export function clampDb(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(VOLUME_DB_MAX, Math.max(VOLUME_DB_MIN, value));
}

export function dBToLinear(db: number): number {
	return 10 ** (clampDb(db) / 20);
}

function clampFadeSeconds(value: number | undefined, maxDuration: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(Math.max(0, value ?? 0), Math.max(0, maxDuration));
}

function resolveFadeMultiplier({
	element,
	localTime,
}: {
	element: AudioCapableElement;
	localTime: number;
}): number {
	const duration = Math.max(0, element.duration / TICKS_PER_SECOND);
	if (duration <= 0) {
		return 1;
	}

	const fadeIn = clampFadeSeconds(element.fadeIn, duration);
	const fadeOut = clampFadeSeconds(element.fadeOut, duration);

	let multiplier = 1;
	if (fadeIn > 0 && localTime < fadeIn) {
		multiplier = Math.min(multiplier, Math.max(0, localTime / fadeIn));
	}

	const fadeOutStart = Math.max(0, duration - fadeOut);
	if (fadeOut > 0 && localTime > fadeOutStart) {
		multiplier = Math.min(
			multiplier,
			Math.max(0, (duration - localTime) / fadeOut),
		);
	}

	return multiplier;
}

export function hasAnimatedVolume({
	element,
}: {
	element: AudioCapableElement;
}): boolean {
	return hasKeyframesForPath({
		animations: element.animations,
		propertyPath: "volume",
	});
}

export function hasAudioFade({
	element,
}: {
	element: AudioCapableElement;
}): boolean {
	const duration = Math.max(0, element.duration);
	if (duration <= 0) {
		return false;
	}

	return (
		clampFadeSeconds(element.fadeIn, duration) > 0 ||
		clampFadeSeconds(element.fadeOut, duration) > 0
	);
}

export function resolveEffectiveAudioGain({
	element,
	trackMuted = false,
	localTime,
}: {
	element: AudioCapableElement;
	trackMuted?: boolean;
	localTime: number;
}): number {
	if (trackMuted || element.muted === true) {
		return 0;
	}

	const resolvedDb = resolveNumberAtTime({
		baseValue: element.volume ?? 0,
		animations: element.animations,
		propertyPath: "volume",
		localTime: Math.round(localTime * TICKS_PER_SECOND),
	});

	return dBToLinear(resolvedDb) * resolveFadeMultiplier({ element, localTime });
}

export function buildAudioGainAutomation({
	element,
	trackMuted = false,
	fromLocalTime,
	toLocalTime,
	stepSeconds = DEFAULT_STEP_SECONDS,
}: {
	element: AudioCapableElement;
	trackMuted?: boolean;
	fromLocalTime: number;
	toLocalTime: number;
	stepSeconds?: number;
}): Array<{ localTime: number; gain: number }> {
	const startTime = Math.max(0, fromLocalTime);
	const endTime = Math.max(startTime, toLocalTime);
	const safeStep =
		Number.isFinite(stepSeconds) && stepSeconds > 0
			? stepSeconds
			: DEFAULT_STEP_SECONDS;
	const points: Array<{ localTime: number; gain: number }> = [];

	for (let localTime = startTime; localTime < endTime; localTime += safeStep) {
		points.push({
			localTime,
			gain: resolveEffectiveAudioGain({
				element,
				trackMuted,
				localTime,
			}),
		});
	}

	points.push({
		localTime: endTime,
		gain: resolveEffectiveAudioGain({
			element,
			trackMuted,
			localTime: endTime,
		}),
	});

	return points;
}
