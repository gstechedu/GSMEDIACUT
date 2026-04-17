export const DEFAULT_VOICE_MODEL_OPTIONS = [
	"Female.pth",
	"Male.pth",
	"G_300.pth",
] as const;

export function mergeVoiceModelOptions(options: string[]) {
	return [...new Set(options.filter(Boolean))];
}
