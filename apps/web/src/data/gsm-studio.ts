export interface StudioFeatureCard {
	id: string;
	title: string;
	description: string;
	tab: "media" | "sounds" | "text" | "stickers" | "effects" | "transitions" | "captions" | "settings";
	status: "ready" | "in-progress" | "planned";
}

export interface TextStylePreset {
	id: string;
	name: string;
	preview: string;
	description: string;
	content: string;
	fontSize: number;
	fontFamily: string;
	color: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline" | "line-through";
	letterSpacing?: number;
	lineHeight?: number;
	background?: {
		enabled: boolean;
		color: string;
		cornerRadius?: number;
		paddingX?: number;
		paddingY?: number;
		offsetX?: number;
		offsetY?: number;
	};
}

export interface TransitionPreset {
	id: string;
	name: string;
	family: string;
	mood: string;
	description: string;
}

export const STUDIO_FEATURE_CARDS: StudioFeatureCard[] = [
	{
		id: "timeline",
		title: "Timeline Editing",
		description: "Multi-track editing, drag-and-drop media, preview, trim, and keyframes.",
		tab: "media",
		status: "ready",
	},
	{
		id: "captions",
		title: "Text And Captions",
		description: "Auto-transcribe speech, then turn it into styled subtitle blocks.",
		tab: "captions",
		status: "ready",
	},
	{
		id: "transitions",
		title: "Transitions",
		description: "Curated GL-transition presets and export pipeline notes for clip-to-clip motion.",
		tab: "transitions",
		status: "in-progress",
	},
	{
		id: "stickers",
		title: "Lottie And Stickers",
		description: "Sticker browsing exists now; Lottie playback is the next visual layer to wire in.",
		tab: "stickers",
		status: "in-progress",
	},
	{
		id: "audio",
		title: "Audio And Speech Tools",
		description: "Sound search, speech-to-text, and future offline whisper.cpp desktop integration.",
		tab: "sounds",
		status: "ready",
	},
	{
		id: "cleanup",
		title: "Watermark Removal",
		description: "Research repos are local. Keep this as an opt-in desktop cleanup workflow first.",
		tab: "settings",
		status: "planned",
	},
];

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
	{
		id: "bubble-pop",
		name: "Bubble Pop",
		preview: "POP",
		description: "Rounded title card with bold lettering for TikTok-style hooks.",
		content: "Make it pop",
		fontSize: 20,
		fontFamily: "Arial",
		color: "#111827",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: 0.5,
		lineHeight: 1,
		background: {
			enabled: true,
			color: "#FDE68A",
			cornerRadius: 28,
			paddingX: 34,
			paddingY: 22,
		},
	},
	{
		id: "glow-night",
		name: "Glow Night",
		preview: "GLOW",
		description: "High-contrast headline block for intros, promos, and music edits.",
		content: "Neon night drop",
		fontSize: 22,
		fontFamily: "Arial",
		color: "#F9FAFB",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: 1.2,
		lineHeight: 1,
		background: {
			enabled: true,
			color: "#0F172A",
			cornerRadius: 18,
			paddingX: 36,
			paddingY: 24,
		},
	},
	{
		id: "social-lower-third",
		name: "Lower Third",
		preview: "HOST",
		description: "Compact speaker tag for interviews, explainers, and commentary.",
		content: "Speaker name",
		fontSize: 16,
		fontFamily: "Arial",
		color: "#FFFFFF",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: 0.6,
		lineHeight: 1.1,
		background: {
			enabled: true,
			color: "#2563EB",
			cornerRadius: 12,
			paddingX: 26,
			paddingY: 16,
		},
	},
	{
		id: "highlight-caption",
		name: "Highlight Caption",
		preview: "CAPTION",
		description: "Subtitle style with a clear highlight block and strong readability.",
		content: "Your words land harder here",
		fontSize: 18,
		fontFamily: "Arial",
		color: "#111827",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: 0.3,
		lineHeight: 1.1,
		background: {
			enabled: true,
			color: "#FACC15",
			cornerRadius: 14,
			paddingX: 28,
			paddingY: 18,
		},
	},
];

export const CAPTION_STYLE_PRESETS = [
	{
		id: "bold-yellow",
		name: "Bold Yellow",
		description: "Bright high-contrast captions similar to short-form social edits.",
		textPresetId: "highlight-caption",
	},
	{
		id: "clean-white",
		name: "Clean White",
		description: "Minimal subtitle treatment with no background and neutral typography.",
		textPresetId: null,
	},
	{
		id: "bubble-card",
		name: "Bubble Card",
		description: "Rounded subtitle card for creator-style commentary clips.",
		textPresetId: "bubble-pop",
	},
] as const;

export const TRANSITION_PRESETS: TransitionPreset[] = [
	{
		id: "crosswarp",
		name: "Crosswarp",
		family: "GL-Transitions",
		mood: "Fast",
		description: "A high-energy warp that works well for quick cuts and creator edits.",
	},
	{
		id: "directional-wipe",
		name: "Directional Wipe",
		family: "GL-Transitions",
		mood: "Clean",
		description: "Simple directional replacement for educational edits and reels.",
	},
	{
		id: "dreamy-zoom",
		name: "Dreamy Zoom",
		family: "GL-Transitions",
		mood: "Soft",
		description: "A smoother zoom blend for mood edits, travel clips, and montages.",
	},
	{
		id: "burn",
		name: "Burn",
		family: "GL-Transitions",
		mood: "Stylized",
		description: "A more aggressive flash transition for music videos and hype moments.",
	},
	{
		id: "fade-grayscale",
		name: "Fade Grayscale",
		family: "GL-Transitions",
		mood: "Editorial",
		description: "A restrained transition for documentaries, explainers, and brand content.",
	},
	{
		id: "windowslice",
		name: "Window Slice",
		family: "GL-Transitions",
		mood: "Graphic",
		description: "Segmented panel motion that fits UI-heavy or kinetic edits.",
	},
] as const;
