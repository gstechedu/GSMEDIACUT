import {
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ChangeEvent,
	type KeyboardEvent,
	type ReactNode,
	type WheelEvent,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import type { MediaAsset } from "@/lib/media/types";
import { processMediaAssets } from "@/lib/media/processing";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/lib/timeline/audio-constants";
import { isSourceAudioSeparated } from "@/lib/timeline/audio-separation";
import { DEFAULTS } from "@/lib/timeline/defaults";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/lib/commands";
import {
	clamp,
	formatNumberForDisplay,
	getFractionDigitsForStep,
	isNearlyEqual,
	snapToStep,
} from "@/utils/math";
import type { AudioElement, VideoElement } from "@/lib/timeline";
import { resolveNumberAtTime } from "@/lib/animation";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { useEditor } from "@/hooks/use-editor";
import { useElementPlayhead } from "../hooks/use-element-playhead";
import { useKeyframedNumberProperty } from "../hooks/use-keyframed-number-property";
import { KeyframeToggle } from "../components/keyframe-toggle";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon } from "@hugeicons/core-free-icons";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { cn } from "@/utils/ui";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePropertiesStore } from "../stores/properties-store";
import { useTimelineStore } from "@/stores/timeline-store";

const VOLUME_STEP = 0.1;
const VOLUME_FRACTION_DIGITS = getFractionDigitsForStep({ step: VOLUME_STEP });
const FADE_STEP = 0.1;
const FADE_FRACTION_DIGITS = getFractionDigitsForStep({ step: FADE_STEP });

const NOISE_MODELS = [
	{ id: "UVR_MDXNET_Main.onnx", label: "MDX Main" },
	{ id: "UVR_MDXNET_1_9703.onnx", label: "MDX Vocal Focus" },
	{ id: "UVR-MDX-NET-Inst_HQ_3.onnx", label: "MDX Instrumental HQ" },
];

type AudioToolMode = "enhance-voice" | "reduce-noise" | "normalize-loudness";

const AUDIO_TOOL_OPTIONS: Array<{
	id: AudioToolMode;
	label: string;
	description: string;
}> = [
	{
		id: "enhance-voice",
		label: "Enhance Voice",
		description: "DeepFilterNet-style local voice cleanup for clearer speech.",
	},
	{
		id: "reduce-noise",
		label: "Reduce Noise",
		description: "Use local UVR / MDX processing to isolate cleaner vocals.",
	},
	{
		id: "normalize-loudness",
		label: "Normalize Loudness",
		description:
			"Normalize the loudness of the selected clip to a target LUFS.",
	},
];

function getNudgedValue({
	value,
	step,
	min,
	max,
	direction,
}: {
	value: number;
	step: number;
	min: number;
	max: number;
	direction: -1 | 1;
}) {
	return clamp({
		value: snapToStep({ value: value + direction * step, step }),
		min,
		max,
	});
}

function usePlainNumberDraft({
	displayValue: sourceDisplay,
	parse,
	onPreview,
	onCommit,
}: {
	displayValue: string;
	parse: (input: string) => number | null;
	onPreview: (value: number) => void;
	onCommit: (value: number) => void;
}) {
	const [, forceRender] = useReducer((version: number) => version + 1, 0);
	const isEditing = useRef(false);
	const draft = useRef("");
	const lastParsedValue = useRef<number | null>(null);

	return {
		displayValue: isEditing.current ? draft.current : sourceDisplay,
		scrubTo: (value: number) => {
			const parsed = parse(String(value));
			if (parsed === null) {
				return;
			}
			lastParsedValue.current = parsed;
			onPreview(parsed);
		},
		commitScrub: () => {
			if (lastParsedValue.current !== null) {
				onCommit(lastParsedValue.current);
			}
		},
		onFocus: () => {
			isEditing.current = true;
			draft.current = sourceDisplay;
			lastParsedValue.current = parse(sourceDisplay);
			forceRender();
		},
		onChange: (event: ChangeEvent<HTMLInputElement>) => {
			draft.current = event.target.value;
			forceRender();

			const parsed = parse(event.target.value);
			if (parsed !== null) {
				lastParsedValue.current = parsed;
				onPreview(parsed);
			}
		},
		onBlur: () => {
			if (lastParsedValue.current !== null) {
				onCommit(lastParsedValue.current);
			}
			isEditing.current = false;
			draft.current = "";
			forceRender();
		},
	};
}

function AudioPanelCard({
	title,
	description,
	action,
	children,
	bodyClassName,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	children: ReactNode;
	bodyClassName?: string;
}) {
	return (
		<div className="rounded-xl border bg-background text-foreground shadow-sm">
			<div className="flex items-start justify-between gap-3 border-b px-4 py-3">
				<div className="min-w-0">
					<div className="text-sm font-semibold">{title}</div>
					{description ? (
						<div className="mt-1 text-xs text-muted-foreground">
							{description}
						</div>
					) : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			<div className={cn("space-y-3 px-4 py-4", bodyClassName)}>{children}</div>
		</div>
	);
}

function AudioMetaTile({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border bg-accent/10 p-3">
			<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</div>
			{hint ? (
				<div className="mt-1 text-xs text-muted-foreground">{hint}</div>
			) : null}
			<div className="mt-3">{children}</div>
		</div>
	);
}

function AudioToolOptionCard({
	label,
	description,
	isSelected,
	onClick,
}: {
	label: string;
	description: string;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={cn(
				"w-full rounded-lg border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring",
				isSelected
					? "border-primary bg-primary/6"
					: "border-border bg-background hover:bg-accent/10",
			)}
			onClick={onClick}
		>
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className={cn(
						"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
						isSelected
							? "border-primary bg-primary"
							: "border-border bg-background",
					)}
				>
					<span
						className={cn(
							"size-1.5 rounded-full bg-white transition-opacity",
							isSelected ? "opacity-100" : "opacity-0",
						)}
					/>
				</span>
				<div className="min-w-0">
					<div className="text-sm font-medium">{label}</div>
					<div className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{description}
					</div>
				</div>
			</div>
		</button>
	);
}

export function AudioTab({
	element,
	mediaAsset,
	trackId,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
	trackId: string;
}) {
	const editor = useEditor();
	const setActivePropertiesTab = usePropertiesStore(
		(state) => state.setActiveTab,
	);
	const setTimelineEditorMode = useTimelineStore(
		(state) => state.setEditorMode,
	);
	const activeProject = useEditor((e) => e.project.getActive());
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const [toolStatus, setToolStatus] = useState<{
		ffmpegAvailable: boolean;
	} | null>(null);
	const [noiseModelName, setNoiseModelName] = useState(NOISE_MODELS[0].id);
	const [selectedTool, setSelectedTool] =
		useState<AudioToolMode>("enhance-voice");
	const [targetLufs, setTargetLufs] = useState("-16");
	const [muteSourceAudio, setMuteSourceAudio] = useState(
		element.type === "video",
	);
	const [processingTool, setProcessingTool] = useState<AudioToolMode | null>(
		null,
	);
	const resolvedVolume = resolveNumberAtTime({
		baseValue: element.volume ?? DEFAULTS.element.volume,
		animations: element.animations,
		propertyPath: "volume",
		localTime,
	});
	const maxFadeSeconds = Math.max(0, element.duration / TICKS_PER_SECOND);
	const fadeInSeconds = clamp({
		value: element.fadeIn ?? DEFAULTS.element.fadeIn,
		min: 0,
		max: maxFadeSeconds,
	});
	const fadeOutSeconds = clamp({
		value: element.fadeOut ?? DEFAULTS.element.fadeOut,
		min: 0,
		max: maxFadeSeconds,
	});
	const [liveVolume, setLiveVolume] = useState(resolvedVolume);
	const [liveFadeIn, setLiveFadeIn] = useState(fadeInSeconds);
	const [liveFadeOut, setLiveFadeOut] = useState(fadeOutSeconds);

	const volume = useKeyframedNumberProperty({
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: "volume",
		localTime,
		isPlayheadWithinElementRange,
		displayValue: formatNumberForDisplay({
			value: liveVolume,
			fractionDigits: VOLUME_FRACTION_DIGITS,
		}),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}

			return clamp({
				value: snapToStep({ value: parsed, step: VOLUME_STEP }),
				min: VOLUME_DB_MIN,
				max: VOLUME_DB_MAX,
			});
		},
		valueAtPlayhead: resolvedVolume,
		step: VOLUME_STEP,
		buildBaseUpdates: ({ value }) => ({
			volume: value,
		}),
	});
	const isDefault =
		volume.hasAnimatedKeyframes && isPlayheadWithinElementRange
			? isNearlyEqual({
					leftValue: resolvedVolume,
					rightValue: DEFAULTS.element.volume,
				})
			: (element.volume ?? DEFAULTS.element.volume) === DEFAULTS.element.volume;
	const isSeparated =
		element.type === "video" && isSourceAudioSeparated({ element });

	useEffect(() => {
		setLiveVolume(resolvedVolume);
	}, [resolvedVolume]);

	useEffect(() => {
		setLiveFadeIn(fadeInSeconds);
	}, [fadeInSeconds]);

	useEffect(() => {
		setLiveFadeOut(fadeOutSeconds);
	}, [fadeOutSeconds]);

	const parseFadeSeconds = (input: string) => {
		const parsed = parseFloat(input);
		if (Number.isNaN(parsed)) {
			return null;
		}

		return clamp({
			value: snapToStep({ value: parsed, step: FADE_STEP }),
			min: 0,
			max: maxFadeSeconds,
		});
	};

	useEffect(() => {
		let cancelled = false;

		void fetch("/api/audio/process", { method: "GET" })
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Failed to load audio tool status");
				}
				return response.json();
			})
			.then((payload) => {
				if (!cancelled) {
					setToolStatus(payload as { ffmpegAvailable: boolean });
				}
			})
			.catch(() => {
				if (!cancelled) {
					setToolStatus(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const hasProcessableSource = Boolean(mediaAsset?.file && activeProject);
	const parsedTargetLufs = clamp({
		value: Number.parseFloat(targetLufs) || -16,
		min: -30,
		max: -5,
	});

	const localToolSummary = useMemo(() => {
		if (!mediaAsset) {
			return "Select a clip with local audio first.";
		}

		if (mediaAsset.type === "video") {
			return "Process the clip audio locally and place the cleaned result under the video.";
		}

		return "Process the uploaded audio locally and swap the clip to the cleaned result.";
	}, [mediaAsset]);
	const selectedToolOption =
		AUDIO_TOOL_OPTIONS.find((tool) => tool.id === selectedTool) ??
		AUDIO_TOOL_OPTIONS[0];
	const activeToolFieldLabel =
		selectedTool === "enhance-voice"
			? "Engine"
			: selectedTool === "reduce-noise"
				? "Model"
				: "Target";
	const activeToolFieldHint =
		selectedTool === "enhance-voice"
			? "Use the local cleanup chain for spoken voice."
			: selectedTool === "reduce-noise"
				? "Pick the local separation model for cleaner vocals."
				: "Choose the final loudness target for the processed clip.";
	const processingDestinationLabel =
		element.type === "video"
			? "Creates a cleaned audio track under the selected video clip."
			: "Replaces the selected uploaded audio clip with the processed result.";
	const processingAvailabilityLabel =
		toolStatus?.ffmpegAvailable === false ? "Unavailable" : "Ready";

	const commitFade = ({
		field,
		value,
	}: {
		field: "fadeIn" | "fadeOut";
		value: number;
	}) => {
		if (field === "fadeIn") {
			setLiveFadeIn(value);
		} else {
			setLiveFadeOut(value);
		}
		previewFade({ field, value });
		editor.timeline.commitPreview();
	};

	const previewFade = ({
		field,
		value,
	}: {
		field: "fadeIn" | "fadeOut";
		value: number;
	}) => {
		if (field === "fadeIn") {
			setLiveFadeIn(value);
		} else {
			setLiveFadeOut(value);
		}
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: field === "fadeIn" ? { fadeIn: value } : { fadeOut: value },
				},
			],
		});
	};

	const importProcessedAsset = async ({ file }: { file: File }) => {
		if (!activeProject) {
			throw new Error("No active project");
		}

		const processedAssets = await processMediaAssets({ files: [file] });
		const processedAsset = processedAssets[0];
		if (!processedAsset) {
			throw new Error("Failed to process the generated audio file.");
		}

		const createdAsset = await editor.media.addMediaAsset({
			projectId: activeProject.metadata.id,
			asset: processedAsset,
		});
		if (!createdAsset) {
			throw new Error("Failed to save the processed audio file.");
		}

		return createdAsset;
	};

	const attachProcessedAsset = async ({
		asset,
		mode,
	}: {
		asset: MediaAsset;
		mode: AudioToolMode;
	}) => {
		if (element.type === "audio" && element.sourceType === "upload") {
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: {
							mediaId: asset.id,
							name: asset.name,
							sourceDuration: asset.duration ?? element.sourceDuration,
						},
					},
				],
			});
			return "updated";
		}

		const addTrackCommand = new AddTrackCommand("audio");
		const insertTrackId = addTrackCommand.getTrackId();
		const insertElementCommand = new InsertElementCommand({
			element: buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name: asset.name,
				duration: asset.duration ?? element.duration,
				startTime: element.startTime,
			}),
			placement: {
				mode: "explicit",
				trackId: insertTrackId,
			},
		});

		editor.command.execute({
			command: new BatchCommand([addTrackCommand, insertElementCommand]),
		});

		if (element.type === "video" && muteSourceAudio) {
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: {
							isSourceAudioEnabled: false,
						},
					},
				],
			});
		}

		return mode === "reduce-noise"
			? "added cleaned stem"
			: "added processed track";
	};

	const handleAudioTool = async (mode: AudioToolMode) => {
		if (!mediaAsset?.file) {
			toast.error("No source audio available");
			return;
		}
		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		setProcessingTool(mode);
		try {
			let outputFile: File;

			if (mode === "reduce-noise") {
				const formData = new FormData();
				formData.append("file", mediaAsset.file, mediaAsset.file.name);
				formData.append("modelName", noiseModelName);
				formData.append("outputMode", "vocals");

				const response = await fetch("/api/audio/separate", {
					method: "POST",
					body: formData,
				});
				if (!response.ok) {
					throw new Error((await response.text()) || "Noise reduction failed");
				}

				const payload = (await response.json()) as {
					outputs: Array<{
						filename: string;
						mimeType: string;
						base64: string;
					}>;
				};
				const output = payload.outputs[0];
				if (!output) {
					throw new Error("No cleaned vocal output was returned.");
				}

				outputFile = new File(
					[Uint8Array.from(atob(output.base64), (char) => char.charCodeAt(0))],
					output.filename,
					{
						type: output.mimeType,
						lastModified: Date.now(),
					},
				);
			} else {
				const formData = new FormData();
				formData.append("file", mediaAsset.file, mediaAsset.file.name);
				formData.append("mode", mode);
				formData.append("targetLufs", String(parsedTargetLufs));

				const response = await fetch("/api/audio/process", {
					method: "POST",
					body: formData,
				});
				if (!response.ok) {
					throw new Error((await response.text()) || "Audio processing failed");
				}

				const payload = (await response.json()) as {
					filename: string;
					mimeType: string;
					base64: string;
				};
				outputFile = new File(
					[Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))],
					payload.filename,
					{
						type: payload.mimeType,
						lastModified: Date.now(),
					},
				);
			}

			const createdAsset = await importProcessedAsset({ file: outputFile });
			const attachOutcome = await attachProcessedAsset({
				asset: createdAsset,
				mode,
			});

			toast.success("Audio tool finished", {
				description:
					attachOutcome === "updated"
						? "The current audio clip now points to the processed result."
						: "A processed audio track was added to the timeline.",
			});
		} catch (error) {
			console.error(error);
			toast.error("Audio tool failed", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setProcessingTool(null);
		}
	};

	const handleWheelStep = ({
		event,
		value,
		step,
		min,
		max,
		onCommit,
	}: {
		event: WheelEvent<HTMLElement>;
		value: number;
		step: number;
		min: number;
		max: number;
		onCommit: (value: number) => void;
	}) => {
		if (event.deltaY === 0) {
			return;
		}

		event.preventDefault();
		onCommit(
			getNudgedValue({
				value,
				step,
				min,
				max,
				direction: event.deltaY < 0 ? 1 : -1,
			}),
		);
	};

	const handleArrowStep = ({
		event,
		value,
		step,
		min,
		max,
		onCommit,
	}: {
		event: KeyboardEvent<HTMLInputElement>;
		value: number;
		step: number;
		min: number;
		max: number;
		onCommit: (value: number) => void;
	}) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
			return;
		}

		event.preventDefault();
		onCommit(
			getNudgedValue({
				value,
				step,
				min,
				max,
				direction: event.key === "ArrowUp" ? 1 : -1,
			}),
		);
	};

	const fadeIn = usePlainNumberDraft({
		displayValue: formatNumberForDisplay({
			value: liveFadeIn,
			fractionDigits: FADE_FRACTION_DIGITS,
		}),
		parse: parseFadeSeconds,
		onPreview: (value) => previewFade({ field: "fadeIn", value }),
		onCommit: (value) => commitFade({ field: "fadeIn", value }),
	});

	const fadeOut = usePlainNumberDraft({
		displayValue: formatNumberForDisplay({
			value: liveFadeOut,
			fractionDigits: FADE_FRACTION_DIGITS,
		}),
		parse: parseFadeSeconds,
		onPreview: (value) => previewFade({ field: "fadeOut", value }),
		onCommit: (value) => commitFade({ field: "fadeOut", value }),
	});

	const basicRows = [
		{
			id: "volume",
			label: "Volume",
			valueLabel: `${formatNumberForDisplay({
				value: liveVolume,
				fractionDigits: VOLUME_FRACTION_DIGITS,
			})}dB`,
			control: (
				<>
					<div className="flex items-center gap-2">
						<Slider
							className="flex-1"
							value={[liveVolume]}
							min={VOLUME_DB_MIN}
							max={VOLUME_DB_MAX}
							step={VOLUME_STEP}
							onValueChange={(values) => {
								const nextValue = values[0] ?? DEFAULTS.element.volume;
								setLiveVolume(nextValue);
								volume.scrubTo(nextValue);
							}}
							onValueCommit={() => volume.commitScrub()}
							onWheel={(event) =>
								handleWheelStep({
									event,
									value: liveVolume,
									step: VOLUME_STEP,
									min: VOLUME_DB_MIN,
									max: VOLUME_DB_MAX,
									onCommit: (value) => {
										setLiveVolume(value);
										volume.commitValue({ value });
									},
								})
							}
						/>
						<NumberField
							className="w-28 shrink-0"
							icon={<HugeiconsIcon icon={VolumeHighIcon} />}
							value={volume.displayValue}
							onFocus={volume.onFocus}
							onChange={volume.onChange}
							onBlur={volume.onBlur}
							onKeyDown={(event) =>
								handleArrowStep({
									event,
									value: liveVolume,
									step: VOLUME_STEP,
									min: VOLUME_DB_MIN,
									max: VOLUME_DB_MAX,
									onCommit: (value) => {
										setLiveVolume(value);
										volume.commitValue({ value });
									},
								})
							}
							onWheel={(event) =>
								handleWheelStep({
									event,
									value: liveVolume,
									step: VOLUME_STEP,
									min: VOLUME_DB_MIN,
									max: VOLUME_DB_MAX,
									onCommit: (value) => {
										setLiveVolume(value);
										volume.commitValue({ value });
									},
								})
							}
							dragSensitivity="slow"
							scrubClamp={{ min: VOLUME_DB_MIN, max: VOLUME_DB_MAX }}
							onScrub={(value) => {
								setLiveVolume(value);
								volume.scrubTo(value);
							}}
							onScrubEnd={volume.commitScrub}
							onReset={() => {
								setLiveVolume(DEFAULTS.element.volume);
								volume.commitValue({
									value: DEFAULTS.element.volume,
								});
							}}
							isDefault={isDefault}
							suffix="dB"
						/>
					</div>
				</>
			),
		},
		{
			id: "fade-in",
			label: "Fade in",
			valueLabel: `${formatNumberForDisplay({
				value: liveFadeIn,
				fractionDigits: FADE_FRACTION_DIGITS,
			})}s`,
			control: (
				<div className="flex items-center gap-2">
					<Slider
						className="flex-1"
						value={[liveFadeIn]}
						min={0}
						max={Math.max(maxFadeSeconds, FADE_STEP)}
						step={FADE_STEP}
						onValueChange={(values) => {
							const nextValue = values[0] ?? DEFAULTS.element.fadeIn;
							setLiveFadeIn(nextValue);
							previewFade({
								field: "fadeIn",
								value: nextValue,
							});
						}}
						onValueCommit={(values) =>
							commitFade({
								field: "fadeIn",
								value: values[0] ?? DEFAULTS.element.fadeIn,
							})
						}
						onWheel={(event) =>
							handleWheelStep({
								event,
								value: liveFadeIn,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeIn",
										value,
									}),
							})
						}
					/>
					<NumberField
						className="w-24 shrink-0"
						value={fadeIn.displayValue}
						onFocus={fadeIn.onFocus}
						onChange={fadeIn.onChange}
						onBlur={fadeIn.onBlur}
						onKeyDown={(event) =>
							handleArrowStep({
								event,
								value: liveFadeIn,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeIn",
										value,
									}),
							})
						}
						onWheel={(event) =>
							handleWheelStep({
								event,
								value: liveFadeIn,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeIn",
										value,
									}),
							})
						}
						dragSensitivity="slow"
						scrubClamp={{ min: 0, max: maxFadeSeconds }}
						onScrub={(value) => {
							setLiveFadeIn(value);
							fadeIn.scrubTo(value);
						}}
						onScrubEnd={fadeIn.commitScrub}
						onReset={() =>
							commitFade({
								field: "fadeIn",
								value: DEFAULTS.element.fadeIn,
							})
						}
						isDefault={fadeInSeconds === DEFAULTS.element.fadeIn}
						suffix="s"
					/>
				</div>
			),
		},
		{
			id: "fade-out",
			label: "Fade out",
			valueLabel: `${formatNumberForDisplay({
				value: liveFadeOut,
				fractionDigits: FADE_FRACTION_DIGITS,
			})}s`,
			control: (
				<div className="flex items-center gap-2">
					<Slider
						className="flex-1"
						value={[liveFadeOut]}
						min={0}
						max={Math.max(maxFadeSeconds, FADE_STEP)}
						step={FADE_STEP}
						onValueChange={(values) => {
							const nextValue = values[0] ?? DEFAULTS.element.fadeOut;
							setLiveFadeOut(nextValue);
							previewFade({
								field: "fadeOut",
								value: nextValue,
							});
						}}
						onValueCommit={(values) =>
							commitFade({
								field: "fadeOut",
								value: values[0] ?? DEFAULTS.element.fadeOut,
							})
						}
						onWheel={(event) =>
							handleWheelStep({
								event,
								value: liveFadeOut,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeOut",
										value,
									}),
							})
						}
					/>
					<NumberField
						className="w-24 shrink-0"
						value={fadeOut.displayValue}
						onFocus={fadeOut.onFocus}
						onChange={fadeOut.onChange}
						onBlur={fadeOut.onBlur}
						onKeyDown={(event) =>
							handleArrowStep({
								event,
								value: liveFadeOut,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeOut",
										value,
									}),
							})
						}
						onWheel={(event) =>
							handleWheelStep({
								event,
								value: fadeOutSeconds,
								step: FADE_STEP,
								min: 0,
								max: maxFadeSeconds,
								onCommit: (value) =>
									commitFade({
										field: "fadeOut",
										value,
									}),
							})
						}
						dragSensitivity="slow"
						scrubClamp={{ min: 0, max: maxFadeSeconds }}
						onScrub={(value) => {
							setLiveFadeOut(value);
							fadeOut.scrubTo(value);
						}}
						onScrubEnd={fadeOut.commitScrub}
						onReset={() =>
							commitFade({
								field: "fadeOut",
								value: DEFAULTS.element.fadeOut,
							})
						}
						isDefault={fadeOutSeconds === DEFAULTS.element.fadeOut}
						suffix="s"
					/>
				</div>
			),
		},
	];

	return (
		<>
			{isSeparated && (
				<div className="mx-4 mt-4 rounded-md border bg-muted/30 p-3">
					<p className="text-sm">Audio has been separated.</p>
					<Button
						className="mt-3"
						size="sm"
						variant="secondary"
						onClick={() =>
							editor.timeline.toggleSourceAudioSeparation({
								trackId,
								elementId: element.id,
							})
						}
					>
						Recover audio
					</Button>
				</div>
			)}
			<Section collapsible sectionKey={`${element.id}:audio`}>
				<SectionHeader>
					<SectionTitle>Audio</SectionTitle>
				</SectionHeader>
				<SectionContent className="space-y-3">
					<AudioPanelCard
						title="Basic"
						description="Adjust gain and fades with the same control layout across this panel."
						action={
							<KeyframeToggle
								isActive={volume.isKeyframedAtTime}
								isDisabled={!isPlayheadWithinElementRange}
								title="Toggle volume keyframe"
								onToggle={volume.toggleKeyframe}
							/>
						}
						bodyClassName="space-y-4"
					>
							{basicRows.map((row) => (
								<div
									key={row.id}
									className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3"
								>
									<div className="space-y-1">
										<div className="text-sm text-foreground">{row.label}</div>
										<div className="text-xs text-muted-foreground">
											{row.valueLabel}
										</div>
									</div>
									<div
										className={cn(
											"min-w-0",
											row.id !== "volume" && "opacity-95",
										)}
									>
										{row.control}
									</div>
								</div>
							))}
					</AudioPanelCard>

					<AudioPanelCard
						title="Transition Flow"
						description="Open transition tools for this selected audio-backed clip."
						action={
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									setActivePropertiesTab(element.type, "transition");
									setTimelineEditorMode("transition");
								}}
							>
								Open Transition
							</Button>
						}
					>
						<div className="rounded-lg border bg-accent/10 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
							Switch to the transition tab when you want to preview or style
							clip-to-clip motion without leaving the current selection.
						</div>
					</AudioPanelCard>

					<AudioPanelCard
						title="Local Audio Tools"
						description={localToolSummary}
						action={
							<div className="rounded-full border bg-accent/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
								{toolStatus?.ffmpegAvailable === false ? "FFmpeg missing" : "Local"}
							</div>
						}
					>
						<div className="grid gap-3">
							{AUDIO_TOOL_OPTIONS.map((tool) => (
								<AudioToolOptionCard
									key={tool.id}
									label={tool.label}
									description={tool.description}
									isSelected={selectedTool === tool.id}
									onClick={() => setSelectedTool(tool.id)}
								/>
							))}
						</div>

						<div className="rounded-xl border bg-accent/10 p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="text-sm font-semibold">
										{selectedToolOption.label}
									</div>
									<div className="mt-1 text-xs leading-relaxed text-muted-foreground">
										{selectedToolOption.description}
									</div>
								</div>
								<div className="rounded-full border bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
									{processingAvailabilityLabel}
								</div>
							</div>

							<div className="mt-3 grid gap-3">
								<AudioMetaTile
									label={activeToolFieldLabel}
									hint={activeToolFieldHint}
								>
									{selectedTool === "enhance-voice" ? (
										<div className="rounded-md border bg-background px-3 py-2.5 text-sm">
											FFmpeg voice cleanup chain
										</div>
									) : null}

									{selectedTool === "reduce-noise" ? (
										<Select
											value={noiseModelName}
											onValueChange={setNoiseModelName}
										>
											<SelectTrigger className="bg-background">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{NOISE_MODELS.map((model) => (
													<SelectItem key={model.id} value={model.id}>
														{model.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : null}

									{selectedTool === "normalize-loudness" ? (
										<NumberField
											value={targetLufs}
											onChange={(event) => setTargetLufs(event.target.value)}
											onBlur={() => setTargetLufs(String(parsedTargetLufs))}
											suffix="LUFS"
										/>
									) : null}
								</AudioMetaTile>

								<AudioMetaTile
									label="Output"
									hint="Every tool uses the same output flow so the result is predictable."
								>
									<div className="space-y-3">
										<div className="rounded-md border bg-background px-3 py-2.5 text-sm leading-relaxed">
											{processingDestinationLabel}
										</div>
										{element.type === "video" ? (
											<div className="flex items-center justify-between rounded-md border bg-background px-3 py-2.5">
												<div>
													<div className="text-sm font-medium">
														Mute source audio
													</div>
													<div className="text-xs text-muted-foreground">
														Keep the processed result on its own audio track.
													</div>
												</div>
												<Switch
													checked={muteSourceAudio}
													onCheckedChange={setMuteSourceAudio}
												/>
											</div>
										) : null}
									</div>
								</AudioMetaTile>

								<Button
									className="w-full"
									size="sm"
									disabled={!hasProcessableSource || processingTool !== null}
									onClick={() => void handleAudioTool(selectedTool)}
								>
									{processingTool === selectedTool
										? "Processing..."
										: `Run ${selectedToolOption.label}`}
								</Button>
							</div>
						</div>
					</AudioPanelCard>

					<SectionFields>
						<SectionField label="Audio Shape">
							<div className="rounded-lg border bg-accent/10 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
								Fade in and fade out now shape the clip gain directly. Volume
								keyframes still control the dB value at the playhead.
							</div>
						</SectionField>
					</SectionFields>
				</SectionContent>
			</Section>
		</>
	);
}
