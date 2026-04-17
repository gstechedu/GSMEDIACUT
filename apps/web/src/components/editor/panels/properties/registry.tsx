import type { ReactNode } from "react";
import type {
	EffectElement,
	GraphicElement,
	ImageElement,
	MaskableElement,
	RetimableElement,
	StickerElement,
	TextElement,
	VisualElement,
	VideoElement,
	AudioElement,
	TimelineElement,
} from "@/lib/timeline";
import type { MediaAsset } from "@/lib/media/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	TextFontIcon,
	ArrowExpandIcon,
	ArrowRightDoubleIcon,
	RainDropIcon,
	MusicNote03Icon,
	MagicWand05Icon,
	MagicWand03Icon,
	DashboardSpeed02Icon,
	Mic01Icon,
} from "@hugeicons/core-free-icons";
import { hasMediaId } from "@/lib/timeline/element-utils";
import { TransformTab } from "./tabs/transform-tab";
import { BlendingTab } from "./tabs/blending-tab";
import { AudioTab } from "./tabs/audio-tab";
import { TextTab } from "./tabs/text-tab";
import { ClipEffectsTab, StandaloneEffectTab } from "./tabs/effects-tab";
import { MasksTab } from "./tabs/masks-tab";
import { SpeedTab } from "./tabs/speed-tab";
import { GraphicTab } from "./tabs/graphic-tab";
import { WatermarkTab } from "./tabs/watermark-tab";
import { SeparateSoundTab } from "./tabs/separate-sound-tab";
import { TransitionTab } from "./tabs/transition-tab";
import { OcShapesIcon } from "@/components/icons";

export type TabContentProps = {
	trackId: string;
};

export type PropertiesTabDef = {
	id: string;
	label: string;
	icon: ReactNode;
	content: (props: TabContentProps) => ReactNode;
};

export type ElementPropertiesConfig = {
	defaultTab: string;
	tabs: PropertiesTabDef[];
};

function buildTransformTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "transform",
		label: "Transform",
		icon: <HugeiconsIcon icon={ArrowExpandIcon} size={16} />,
		content: ({ trackId }) => (
			<TransformTab element={element} trackId={trackId} />
		),
	};
}

function buildBlendingTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "blending",
		label: "Blending",
		icon: <HugeiconsIcon icon={RainDropIcon} size={16} />,
		content: ({ trackId }) => (
			<BlendingTab element={element} trackId={trackId} />
		),
	};
}

function buildAudioTab({
	element,
	mediaAsset,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
}): PropertiesTabDef {
	return {
		id: "audio",
		label: "Audio",
		icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
		content: ({ trackId }) => (
			<AudioTab element={element} mediaAsset={mediaAsset} trackId={trackId} />
		),
	};
}

function buildTransitionTab({
	element,
	mediaAsset,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
}): PropertiesTabDef {
	return {
		id: "transition",
		label: "Voice",
		icon: <HugeiconsIcon icon={ArrowRightDoubleIcon} size={16} />,
		content: ({ trackId }) => (
			<TransitionTab
				element={element}
				mediaAsset={mediaAsset}
				trackId={trackId}
			/>
		),
	};
}

function buildSpeedTab({
	element,
}: {
	element: RetimableElement;
}): PropertiesTabDef {
	return {
		id: "speed",
		label: "Speed",
		icon: <HugeiconsIcon icon={DashboardSpeed02Icon} size={16} />,
		content: ({ trackId }) => <SpeedTab element={element} trackId={trackId} />,
	};
}

function buildMasksTab({
	element,
}: {
	element: MaskableElement;
}): PropertiesTabDef {
	return {
		id: "masks",
		label: "Masks",
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <MasksTab element={element} trackId={trackId} />,
	};
}

function buildClipEffectsTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: "Effects",
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<ClipEffectsTab element={element} trackId={trackId} />
		),
	};
}

function buildWatermarkTab({
	element,
	mediaAsset,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
}): PropertiesTabDef {
	return {
		id: "watermark",
		label: "Watermark",
		icon: <HugeiconsIcon icon={MagicWand03Icon} size={16} />,
		content: ({ trackId }) => (
			<WatermarkTab
				element={element}
				mediaAsset={mediaAsset}
				trackId={trackId}
			/>
		),
	};
}

function buildSeparateSoundTab({
	element,
	mediaAsset,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
}): PropertiesTabDef {
	return {
		id: "separate-sound",
		label: "Separate Sound",
		icon: <HugeiconsIcon icon={Mic01Icon} size={16} />,
		content: ({ trackId }) => (
			<SeparateSoundTab
				element={element}
				mediaAsset={mediaAsset}
				trackId={trackId}
			/>
		),
	};
}

function buildTextTab({ element }: { element: TextElement }): PropertiesTabDef {
	return {
		id: "text",
		label: "Text",
		icon: <HugeiconsIcon icon={TextFontIcon} size={16} />,
		content: ({ trackId }) => <TextTab element={element} trackId={trackId} />,
	};
}

function buildGraphicTab({
	element,
}: {
	element: GraphicElement;
}): PropertiesTabDef {
	return {
		id: "graphic",
		label: "Graphic",
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => (
			<GraphicTab element={element} trackId={trackId} />
		),
	};
}

function buildStandaloneEffectTab({
	element,
}: {
	element: EffectElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: "Effects",
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<StandaloneEffectTab element={element} trackId={trackId} />
		),
	};
}

function getTextConfig({
	element,
}: {
	element: TextElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "text",
		tabs: [
			buildTextTab({ element }),
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
		],
	};
}

function getVideoConfig({
	element,
	mediaAsset,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
}): ElementPropertiesConfig {
	const showAudioTab = mediaAsset?.hasAudio !== false;
	return {
		defaultTab: "watermark",
		tabs: [
			buildTransformTab({ element }),
			buildWatermarkTab({ element, mediaAsset }),
			...(showAudioTab ? [buildAudioTab({ element, mediaAsset })] : []),
			...(showAudioTab ? [buildTransitionTab({ element, mediaAsset })] : []),
			...(showAudioTab ? [buildSeparateSoundTab({ element, mediaAsset })] : []),
			buildSpeedTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getImageConfig({
	element,
}: {
	element: ImageElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getStickerConfig({
	element,
}: {
	element: StickerElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getGraphicConfig({
	element,
}: {
	element: GraphicElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "graphic",
		tabs: [
			buildGraphicTab({ element }),
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getAudioConfig({
	element,
	mediaAsset,
}: {
	element: AudioElement;
	mediaAsset: MediaAsset | undefined;
}): ElementPropertiesConfig {
	return {
		defaultTab: "audio",
		tabs: [
			buildAudioTab({ element, mediaAsset }),
			buildTransitionTab({ element, mediaAsset }),
			buildSeparateSoundTab({ element, mediaAsset }),
			buildSpeedTab({ element }),
		],
	};
}

function getEffectConfig({
	element,
}: {
	element: EffectElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "effects",
		tabs: [buildStandaloneEffectTab({ element })],
	};
}

export function getPropertiesConfig({
	element,
	mediaAssets,
}: {
	element: TimelineElement;
	mediaAssets: MediaAsset[];
}): ElementPropertiesConfig {
	switch (element.type) {
		case "text":
			return getTextConfig({ element });
		case "video": {
			const mediaAsset = mediaAssets.find((a) => a.id === element.mediaId);
			return getVideoConfig({ element, mediaAsset });
		}
		case "image":
			return getImageConfig({ element });
		case "sticker":
			return getStickerConfig({ element });
		case "graphic":
			return getGraphicConfig({ element });
		case "audio":
			return getAudioConfig({
				element,
				mediaAsset: hasMediaId(element)
					? mediaAssets.find((a) => a.id === element.mediaId)
					: undefined,
			});
		case "effect":
			return getEffectConfig({ element });
	}
}
