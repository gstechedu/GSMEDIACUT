"use client";

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ArrowRightDoubleIcon,
	MusicNote03Icon,
	RainDropIcon,
	TextFontIcon,
} from "@hugeicons/core-free-icons";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FontPicker } from "@/components/ui/font-picker";
import { NumberField } from "@/components/ui/number-field";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/hooks/use-editor";
import { usePropertiesStore } from "./stores/properties-store";
import { cn } from "@/utils/ui";
import type {
	AudioElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
	VideoElement,
	VisualElement,
} from "@/lib/timeline";
import type { BlendMode } from "@/lib/rendering";
import { DEFAULTS } from "@/lib/timeline/defaults";
import {
	DEFAULT_TEXT_COLOR,
	MAX_FONT_SIZE,
	MIN_FONT_SIZE,
} from "@/lib/text/constants";
import { clamp } from "@/utils/math";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/lib/timeline/audio-constants";
import { TICKS_PER_SECOND } from "@/lib/wasm";

type SelectionRef = {
	trackId: string;
	elementId: string;
};

type SelectedElementWithTrack = {
	track: TimelineTrack;
	element: TimelineElement;
};

type MultiSelectionTab = {
	id: string;
	label: string;
	icon: ReactNode;
	content: ReactNode;
};

type BatchNumberDraftParams = {
	displayValue: string;
	parse: (input: string) => number | null;
	onCommit: (value: number) => void;
};

const BLEND_MODE_GROUPS: { value: BlendMode; label: string }[][] = [
	[{ value: "normal", label: "Normal" }],
	[
		{ value: "darken", label: "Darken" },
		{ value: "multiply", label: "Multiply" },
		{ value: "color-burn", label: "Color Burn" },
	],
	[
		{ value: "lighten", label: "Lighten" },
		{ value: "screen", label: "Screen" },
		{ value: "plus-lighter", label: "Plus Lighter" },
		{ value: "color-dodge", label: "Color Dodge" },
	],
	[
		{ value: "overlay", label: "Overlay" },
		{ value: "soft-light", label: "Soft Light" },
		{ value: "hard-light", label: "Hard Light" },
	],
	[
		{ value: "difference", label: "Difference" },
		{ value: "exclusion", label: "Exclusion" },
	],
	[
		{ value: "hue", label: "Hue" },
		{ value: "saturation", label: "Saturation" },
		{ value: "color", label: "Color" },
		{ value: "luminosity", label: "Luminosity" },
	],
];

function getCommonValue<T>(values: T[]): T | null {
	if (values.length === 0) return null;
	const first = values[0];
	return values.every((value) => value === first) ? first : null;
}

function humanizeType(type: TimelineElement["type"]) {
	switch (type) {
		case "audio":
			return "audio";
		case "effect":
			return "effect";
		case "graphic":
			return "graphic";
		case "image":
			return "image";
		case "sticker":
			return "sticker";
		case "text":
			return "text";
		case "video":
			return "video";
	}
}

function buildSelectionSummary(elementsWithTracks: SelectedElementWithTrack[]) {
	const counts = new Map<TimelineElement["type"], number>();
	for (const { element } of elementsWithTracks) {
		counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([type, count]) => `${count} ${humanizeType(type)}${count === 1 ? "" : "s"}`)
		.join(", ");
}

function getSelectionGroupKey(elementsWithTracks: SelectedElementWithTrack[]) {
	const types = [...new Set(elementsWithTracks.map(({ element }) => element.type))]
		.sort()
		.join("+");
	return `multi:${types || "selection"}`;
}

function isTextElement(element: TimelineElement): element is TextElement {
	return element.type === "text";
}

function isTextSelectionItem(
	item: SelectedElementWithTrack,
): item is { track: TimelineTrack; element: TextElement } {
	return item.element.type === "text";
}

function isVisualElement(element: TimelineElement): element is VisualElement {
	return (
		element.type === "video" ||
		element.type === "image" ||
		element.type === "text" ||
		element.type === "sticker" ||
		element.type === "graphic"
	);
}

function isVisualSelectionItem(
	item: SelectedElementWithTrack,
): item is { track: TimelineTrack; element: VisualElement } {
	return isVisualElement(item.element);
}

function isAudioEditableElement(
	element: TimelineElement,
): element is AudioElement | VideoElement {
	return element.type === "audio" || element.type === "video";
}

function isAudioSelectionItem(
	item: SelectedElementWithTrack,
): item is { track: TimelineTrack; element: AudioElement | VideoElement } {
	return isAudioEditableElement(item.element);
}

function useBatchNumberDraft({
	displayValue,
	parse,
	onCommit,
}: BatchNumberDraftParams) {
	const [draft, setDraft] = useState(displayValue);
	const isEditing = useRef(false);
	const lastParsedValue = useRef<number | null>(null);

	useEffect(() => {
		if (!isEditing.current) {
			setDraft(displayValue);
			lastParsedValue.current = parse(displayValue);
		}
	}, [displayValue, parse]);

	return {
		displayValue: draft,
		onFocus: () => {
			isEditing.current = true;
			lastParsedValue.current = parse(draft);
		},
		onChange: (event: ChangeEvent<HTMLInputElement>) => {
			const nextValue = event.target.value;
			setDraft(nextValue);
			const parsed = parse(nextValue);
			if (parsed !== null) {
				lastParsedValue.current = parsed;
			}
		},
		onBlur: () => {
			if (lastParsedValue.current !== null) {
				onCommit(lastParsedValue.current);
			}
			isEditing.current = false;
		},
	};
}

function BatchTextTab({
	elementsWithTracks,
}: {
	elementsWithTracks: SelectedElementWithTrack[];
}) {
	const editor = useEditor();
	const textItems = elementsWithTracks.filter(isTextSelectionItem);
	const textElements = textItems.map(({ element }) => element);
	const commonFontFamily = getCommonValue(
		textElements.map((element) => element.fontFamily),
	);
	const commonFontSize = getCommonValue(
		textElements.map((element) => element.fontSize),
	);
	const commonColor = getCommonValue(textElements.map((element) => element.color));
	const commonFontWeight = getCommonValue(
		textElements.map((element) => element.fontWeight),
	);
	const commonFontStyle = getCommonValue(
		textElements.map((element) => element.fontStyle),
	);
	const commonTextDecoration = getCommonValue(
		textElements.map((element) => element.textDecoration),
	);
	const commonTextAlign = getCommonValue(
		textElements.map((element) => element.textAlign),
	);

	const updateTextElements = (patch: Partial<TextElement>) => {
		editor.timeline.updateElements({
			updates: textItems.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				patch,
			})),
		});
	};

	const fontSize = useBatchNumberDraft({
		displayValue: commonFontSize != null ? String(commonFontSize) : "",
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clamp({
				value: Math.round(parsed),
				min: MIN_FONT_SIZE,
				max: MAX_FONT_SIZE,
			});
		},
		onCommit: (value) => updateTextElements({ fontSize: value }),
	});

	return (
		<div className="flex flex-col">
			<Section collapsible sectionKey="multi:text:typography">
				<SectionHeader>
					<SectionTitle>Typography</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<SectionField label="Font">
							<FontPicker
								defaultValue={commonFontFamily ?? undefined}
								onValueChange={(value) =>
									updateTextElements({ fontFamily: value })
								}
							/>
						</SectionField>
						<SectionField label="Size">
							<NumberField
								value={fontSize.displayValue}
								placeholder={commonFontSize == null ? "Mixed" : undefined}
								min={MIN_FONT_SIZE}
								max={MAX_FONT_SIZE}
								onFocus={fontSize.onFocus}
								onChange={fontSize.onChange}
								onBlur={fontSize.onBlur}
								onReset={() =>
									updateTextElements({
										fontSize: DEFAULTS.text.element.fontSize,
									})
								}
								isDefault={textElements.every(
									(element) =>
										element.fontSize === DEFAULTS.text.element.fontSize,
								)}
							/>
						</SectionField>
						<SectionField label="Color">
							<ColorPicker
								value={(
									commonColor ?? DEFAULT_TEXT_COLOR
								).replace("#", "")}
								onChangeEnd={(color) =>
									updateTextElements({ color: `#${color}` })
								}
							/>
						</SectionField>
					</SectionFields>
				</SectionContent>
			</Section>
			<Section collapsible sectionKey="multi:text:style">
				<SectionHeader>
					<SectionTitle>Style</SectionTitle>
				</SectionHeader>
				<SectionContent className="space-y-4">
					<SectionField label="Emphasis">
						<div className="flex flex-wrap gap-2">
							<Button
								variant={
									commonFontWeight === "bold" ? "secondary" : "outline"
								}
								size="sm"
								onClick={() =>
									updateTextElements({
										fontWeight:
											commonFontWeight === "bold" ? "normal" : "bold",
									})
								}
							>
								Bold
							</Button>
							<Button
								variant={
									commonFontStyle === "italic" ? "secondary" : "outline"
								}
								size="sm"
								onClick={() =>
									updateTextElements({
										fontStyle:
											commonFontStyle === "italic" ? "normal" : "italic",
									})
								}
							>
								Italic
							</Button>
							<Button
								variant={
									commonTextDecoration === "underline"
										? "secondary"
										: "outline"
								}
								size="sm"
								onClick={() =>
									updateTextElements({
										textDecoration:
											commonTextDecoration === "underline"
												? "none"
												: "underline",
									})
								}
							>
								Underline
							</Button>
						</div>
					</SectionField>
					<SectionField label="Alignment">
						<div className="flex flex-wrap gap-2">
							{(["left", "center", "right"] as const).map((alignment) => (
								<Button
									key={alignment}
									variant={
										commonTextAlign === alignment ? "secondary" : "outline"
									}
									size="sm"
									onClick={() =>
										updateTextElements({ textAlign: alignment })
									}
								>
									{alignment[0]?.toUpperCase()}
									{alignment.slice(1)}
								</Button>
							))}
						</div>
					</SectionField>
				</SectionContent>
			</Section>
		</div>
	);
}

function BatchBlendingTab({
	elementsWithTracks,
}: {
	elementsWithTracks: SelectedElementWithTrack[];
}) {
	const editor = useEditor();
	const visualItems = elementsWithTracks.filter(isVisualSelectionItem);
	const visualElements = visualItems.map(({ element }) => element);
	const commonOpacity = getCommonValue(
		visualElements.map((element) => Math.round(element.opacity * 100)),
	);
	const commonBlendMode = getCommonValue(
		visualElements.map(
			(element) => element.blendMode ?? DEFAULTS.element.blendMode,
		),
	);

	const updateVisualElements = (patch: Partial<VisualElement>) => {
		editor.timeline.updateElements({
			updates: visualItems.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				patch,
			})),
		});
	};

	const opacity = useBatchNumberDraft({
		displayValue: commonOpacity != null ? String(commonOpacity) : "",
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clamp({ value: parsed, min: 0, max: 100 });
		},
		onCommit: (value) => updateVisualElements({ opacity: value / 100 }),
	});

	return (
		<div className="flex flex-col">
			<Section collapsible sectionKey="multi:blending">
				<SectionHeader>
					<SectionTitle>Blending</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<div className="flex items-start gap-2">
						<SectionField label="Opacity" className="w-1/2">
							<NumberField
								value={opacity.displayValue}
								placeholder={commonOpacity == null ? "Mixed" : undefined}
								min={0}
								max={100}
								onFocus={opacity.onFocus}
								onChange={opacity.onChange}
								onBlur={opacity.onBlur}
								onReset={() =>
									updateVisualElements({
										opacity: DEFAULTS.element.opacity,
									})
								}
								isDefault={visualElements.every(
									(element) => element.opacity === DEFAULTS.element.opacity,
								)}
								suffix="%"
							/>
						</SectionField>
						<SectionField label="Blend mode" className="w-1/2">
							<Select
								value={commonBlendMode ?? undefined}
								onValueChange={(value) =>
									updateVisualElements({ blendMode: value as BlendMode })
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Mixed values" />
								</SelectTrigger>
								<SelectContent className="w-40">
									{BLEND_MODE_GROUPS.map((group, groupIndex) => (
										<div key={group[0]?.value ?? `blend-group-${groupIndex}`}>
											{group.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
											{groupIndex < BLEND_MODE_GROUPS.length - 1 ? (
												<SelectSeparator />
											) : null}
										</div>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</div>
				</SectionContent>
			</Section>
		</div>
	);
}

function BatchAudioTab({
	elementsWithTracks,
}: {
	elementsWithTracks: SelectedElementWithTrack[];
}) {
	const editor = useEditor();
	const audioItems = elementsWithTracks.filter(isAudioSelectionItem);
	const audioElements = audioItems.map(({ element }) => element);
	const commonVolume = getCommonValue(
		audioElements.map((element) =>
			element.volume ?? DEFAULTS.element.volume,
		),
	);
	const commonFadeIn = getCommonValue(
		audioElements.map((element) =>
			element.fadeIn ?? DEFAULTS.element.fadeIn,
		),
	);
	const commonFadeOut = getCommonValue(
		audioElements.map((element) =>
			element.fadeOut ?? DEFAULTS.element.fadeOut,
		),
	);

	const updateAudioElements = (
		buildPatch: (
			element: AudioElement | VideoElement,
		) => Partial<AudioElement | VideoElement>,
	) => {
		editor.timeline.updateElements({
			updates: audioItems.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				patch: buildPatch(element),
			})),
		});
	};

	const volume = useBatchNumberDraft({
		displayValue:
			commonVolume != null ? commonVolume.toFixed(1).replace(/\.0$/, "") : "",
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clamp({ value: parsed, min: VOLUME_DB_MIN, max: VOLUME_DB_MAX });
		},
		onCommit: (value) => updateAudioElements(() => ({ volume: value })),
	});

	const fadeIn = useBatchNumberDraft({
		displayValue:
			commonFadeIn != null ? commonFadeIn.toFixed(1).replace(/\.0$/, "") : "",
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(0, parsed);
		},
		onCommit: (value) =>
			updateAudioElements((element) => ({
				fadeIn: clamp({
					value,
					min: 0,
					max: Math.max(0, element.duration / TICKS_PER_SECOND),
				}),
			})),
	});

	const fadeOut = useBatchNumberDraft({
		displayValue:
			commonFadeOut != null ? commonFadeOut.toFixed(1).replace(/\.0$/, "") : "",
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(0, parsed);
		},
		onCommit: (value) =>
			updateAudioElements((element) => ({
				fadeOut: clamp({
					value,
					min: 0,
					max: Math.max(0, element.duration / TICKS_PER_SECOND),
				}),
			})),
	});

	return (
		<div className="flex flex-col">
			<Section collapsible sectionKey="multi:audio">
				<SectionHeader>
					<SectionTitle>Audio</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<SectionField label="Volume">
							<NumberField
								value={volume.displayValue}
								placeholder={commonVolume == null ? "Mixed" : undefined}
								min={VOLUME_DB_MIN}
								max={VOLUME_DB_MAX}
								onFocus={volume.onFocus}
								onChange={volume.onChange}
								onBlur={volume.onBlur}
								onReset={() =>
									updateAudioElements(() => ({
										volume: DEFAULTS.element.volume,
									}))
								}
								isDefault={audioElements.every(
									(element) =>
										(element.volume ?? DEFAULTS.element.volume) ===
										DEFAULTS.element.volume,
								)}
								suffix="dB"
							/>
						</SectionField>
						<div className="flex items-start gap-2">
							<SectionField label="Fade in" className="w-1/2">
								<NumberField
									value={fadeIn.displayValue}
									placeholder={commonFadeIn == null ? "Mixed" : undefined}
									min={0}
									onFocus={fadeIn.onFocus}
									onChange={fadeIn.onChange}
									onBlur={fadeIn.onBlur}
									onReset={() =>
										updateAudioElements(() => ({
											fadeIn: DEFAULTS.element.fadeIn,
										}))
									}
									isDefault={audioElements.every(
										(element) =>
											(element.fadeIn ?? DEFAULTS.element.fadeIn) ===
											DEFAULTS.element.fadeIn,
									)}
									suffix="s"
								/>
							</SectionField>
							<SectionField label="Fade out" className="w-1/2">
								<NumberField
									value={fadeOut.displayValue}
									placeholder={commonFadeOut == null ? "Mixed" : undefined}
									min={0}
									onFocus={fadeOut.onFocus}
									onChange={fadeOut.onChange}
									onBlur={fadeOut.onBlur}
									onReset={() =>
										updateAudioElements(() => ({
											fadeOut: DEFAULTS.element.fadeOut,
										}))
									}
									isDefault={audioElements.every(
										(element) =>
											(element.fadeOut ?? DEFAULTS.element.fadeOut) ===
											DEFAULTS.element.fadeOut,
									)}
									suffix="s"
								/>
							</SectionField>
						</div>
					</SectionFields>
				</SectionContent>
			</Section>
		</div>
	);
}

function MultiSelectionEmptyState({
	count,
	summary,
}: {
	count: number;
	summary: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
			<div className="text-sm font-semibold">{count} elements selected</div>
			<div className="text-muted-foreground max-w-xs text-sm">{summary}</div>
			<div className="text-muted-foreground max-w-xs text-xs">
				Batch editing is available when the selection shares text, audio, or
				blending properties.
			</div>
		</div>
	);
}

export function MultiSelectionPanel({
	selectedElements,
}: {
	selectedElements: SelectionRef[];
}) {
	const editor = useEditor();
	const { activeTabPerType, setActiveTab } = usePropertiesStore();
	const elementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});

	const summary = useMemo(
		() => buildSelectionSummary(elementsWithTracks),
		[elementsWithTracks],
	);

	const allText =
		elementsWithTracks.length > 0 &&
		elementsWithTracks.every(({ element }) => isTextElement(element));
	const allVisual =
		elementsWithTracks.length > 0 &&
		elementsWithTracks.every(({ element }) => isVisualElement(element));
	const allAudioEditable =
		elementsWithTracks.length > 0 &&
		elementsWithTracks.every(({ element }) => isAudioEditableElement(element));

	const groupKey = getSelectionGroupKey(elementsWithTracks);
	const tabs: MultiSelectionTab[] = [];

	if (allText) {
		tabs.push({
			id: "text",
			label: "Text",
			icon: <HugeiconsIcon icon={TextFontIcon} size={16} />,
			content: <BatchTextTab elementsWithTracks={elementsWithTracks} />,
		});
	}

	if (allVisual) {
		tabs.push({
			id: "blending",
			label: "Blending",
			icon: <HugeiconsIcon icon={RainDropIcon} size={16} />,
			content: <BatchBlendingTab elementsWithTracks={elementsWithTracks} />,
		});
	}

	if (allAudioEditable) {
		tabs.push({
			id: "audio",
			label: "Audio",
			icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
			content: <BatchAudioTab elementsWithTracks={elementsWithTracks} />,
		});
	}

	const storedTabId = activeTabPerType[groupKey];
	const activeTab =
		tabs.find((tab) => tab.id === storedTabId) ??
		tabs[0] ?? {
			id: "selection",
			label: "Selection",
			icon: <HugeiconsIcon icon={ArrowRightDoubleIcon} size={16} />,
			content: (
				<MultiSelectionEmptyState
					count={selectedElements.length}
					summary={summary}
				/>
			),
		};

	return (
		<div className="panel bg-background flex h-full overflow-hidden rounded-sm border">
			<TooltipProvider delayDuration={0}>
				<div className="flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-1 scrollbar-hidden">
					{tabs.length > 0 ? (
						tabs.map((tab) => (
							<Tooltip key={tab.id}>
								<TooltipTrigger asChild>
									<Button
										variant={tab.id === activeTab.id ? "secondary" : "ghost"}
										size="icon"
										onClick={() => setActiveTab(groupKey, tab.id)}
										aria-label={tab.label}
										className={cn(
											"size-8 shrink-0",
											tab.id !== activeTab.id && "text-muted-foreground",
										)}
									>
										{tab.icon}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="right">{tab.label}</TooltipContent>
							</Tooltip>
						))
					) : (
						<div className="text-muted-foreground flex h-8 w-8 items-center justify-center">
							{activeTab.icon}
						</div>
					)}
				</div>
			</TooltipProvider>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="border-b px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold">{activeTab.label}</span>
						<span className="text-muted-foreground truncate text-xs">
							{summary}
						</span>
					</div>
				</div>
				<ScrollArea className="flex-1 scrollbar-hidden">
					{activeTab.content}
				</ScrollArea>
			</div>
		</div>
	);
}
