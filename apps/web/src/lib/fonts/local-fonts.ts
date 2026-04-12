const SCRIPT_AWARE_FALLBACKS = [
	"Noto Sans Khmer",
	"Noto Serif Khmer",
	"Noto Sans Thai",
	"Noto Naskh Arabic",
	"Noto Sans Devanagari",
	"Noto Sans SC",
	"Noto Sans JP",
	"Noto Sans KR",
	"Noto Sans",
	"sans-serif",
] as const;

function quoteFontFamily({ family }: { family: string }): string {
	return `"${family.replace(/"/g, '\\"')}"`;
}

export function buildFontFamilyStack({
	primaryFamily,
}: {
	primaryFamily: string;
}): string {
	const uniqueFamilies = new Set<string>([
		primaryFamily,
		...SCRIPT_AWARE_FALLBACKS,
	]);

	return [...uniqueFamilies]
		.map((family) =>
			family.includes(" ") ? quoteFontFamily({ family }) : family,
		)
		.join(", ");
}
