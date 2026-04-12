export const SYSTEM_FONTS = new Set([
	"Arial",
	"Helvetica",
	"Times New Roman",
	"Courier New",
	"Verdana",
	"Georgia",
	"monospace",
	"sans-serif",
	"serif",
]);

export const BUNDLED_FONT_FAMILIES = [
	"Noto Sans",
	"Noto Sans Khmer",
	"Noto Serif Khmer",
	"Noto Sans Thai",
	"Noto Naskh Arabic",
	"Noto Sans Devanagari",
	"Noto Sans SC",
	"Noto Sans JP",
	"Noto Sans KR",
] as const;

export const LOCAL_FONT_FAMILIES = new Set<string>([
	...SYSTEM_FONTS,
	...BUNDLED_FONT_FAMILIES,
]);
