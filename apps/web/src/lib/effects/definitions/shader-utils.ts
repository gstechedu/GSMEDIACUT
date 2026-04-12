export function parseNumberParam({
	effectParams,
	key,
	fallback,
}: {
	effectParams: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const raw = effectParams[key];
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}

	const parsed = Number.parseFloat(String(raw));
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentToPixels({
	intensity,
	width,
	basePixels,
	widthRatio,
}: {
	intensity: number;
	width: number;
	basePixels: number;
	widthRatio: number;
}): number {
	return (intensity / 100) * Math.max(basePixels, width * widthRatio);
}
