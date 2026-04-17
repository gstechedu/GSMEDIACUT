"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AiAudioIcon,
	Mic01Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/lib/commands";
import { processMediaAssets } from "@/lib/media/processing";
import type { MediaAsset } from "@/lib/media/types";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import type { AudioElement, VideoElement } from "@/lib/timeline";
import { useEditor } from "@/hooks/use-editor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { cn } from "@/utils/ui";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";

type SeparatorStatus = {
	available: boolean;
	binary: string;
	defaultModel: string;
	models: Array<{ id: string; label: string }>;
	installHint: string;
};

type SeparateOutput = {
	stemType: "vocals" | "instrumental" | "other";
	filename: string;
	mimeType: string;
	base64: string;
};

type OutputMode = "both" | "vocals" | "instrumental";

type CreatedStemSummary = {
	id: string;
	name: string;
	stemType: SeparateOutput["stemType"];
};

function getSeparateSoundTaskKey(assetId: string) {
	return `separate-sound:${assetId}`;
}

function getStemTone(stemType: SeparateOutput["stemType"]) {
	switch (stemType) {
		case "vocals":
			return "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
		case "instrumental":
			return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300";
		default:
			return "border-border bg-muted/40 text-muted-foreground";
	}
}

function getStemLabel(stemType: SeparateOutput["stemType"]) {
	switch (stemType) {
		case "vocals":
			return "Vocals";
		case "instrumental":
			return "Instrumental";
		default:
			return "Other Stem";
	}
}

function getModelHint(modelName: string) {
	switch (modelName) {
		case "UVR_MDXNET_Main.onnx":
			return "Balanced split when you want a safer all-round model.";
		case "UVR_MDXNET_1_9703.onnx":
			return "More vocal-focused extraction when speech needs priority.";
		case "UVR-MDX-NET-Inst_HQ_3.onnx":
			return "Heavier instrumental-focused separation for music beds.";
		default:
			return "Local MDX/UVR separation on this PC.";
	}
}

export function SeparateSoundTab({
	element,
	mediaAsset,
	trackId,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | undefined;
	trackId: string;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const [status, setStatus] = useState<SeparatorStatus | null>(null);
	const [isLoadingStatus, setIsLoadingStatus] = useState(true);
	const [modelName, setModelName] = useState("UVR_MDXNET_Main.onnx");
	const [outputMode, setOutputMode] = useState<OutputMode>("both");
	const [muteSourceAudio, setMuteSourceAudio] = useState(
		element.type === "video",
	);
	const taskKey = mediaAsset?.id
		? getSeparateSoundTaskKey(mediaAsset.id)
		: null;
	const task = useBackgroundTasksStore((state) =>
		taskKey ? (state.tasksByKey[taskKey] ?? null) : null,
	);
	const startTask = useBackgroundTasksStore((state) => state.startTask);
	const updateTask = useBackgroundTasksStore((state) => state.updateTask);
	const completeTask = useBackgroundTasksStore((state) => state.completeTask);
	const failTask = useBackgroundTasksStore((state) => state.failTask);
	const isProcessing = task?.status === "running";
	const lastOutputs = Array.isArray(task?.metadata?.lastOutputs)
		? (task.metadata.lastOutputs as CreatedStemSummary[])
		: [];

	const hasSourceFile = Boolean(mediaAsset?.file);
	const canSeparate =
		hasSourceFile &&
		(element.type === "audio" || mediaAsset?.hasAudio !== false);

	useEffect(() => {
		let cancelled = false;

		void fetch("/api/audio/separate", { method: "GET" })
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Failed to load separator status");
				}
				return response.json();
			})
			.then((data) => {
				if (cancelled) {
					return;
				}
				const nextStatus = data as SeparatorStatus;
				setStatus(nextStatus);
				setModelName(nextStatus.defaultModel || "UVR_MDXNET_Main.onnx");
			})
			.catch(() => {
				if (!cancelled) {
					setStatus(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingStatus(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const sourceInfo = useMemo(() => {
		if (!mediaAsset) {
			return "No source clip";
		}

		if (mediaAsset.type === "audio") {
			return mediaAsset.name;
		}

		return `${mediaAsset.name}${mediaAsset.hasAudio === false ? " (no audio track)" : ""}`;
	}, [mediaAsset]);

	const sourceMeta = useMemo(() => {
		if (!mediaAsset) {
			return "Select an uploaded clip with audio.";
		}

		const typeLabel = mediaAsset.type === "video" ? "Video clip" : "Audio clip";
		const audioLabel =
			mediaAsset.type === "video"
				? mediaAsset.hasAudio === false
					? "No embedded audio"
					: "Embedded audio detected"
				: "Direct audio source";
		return `${typeLabel} · ${audioLabel}`;
	}, [mediaAsset]);

	const modeDescription = useMemo(() => {
		switch (outputMode) {
			case "vocals":
				return "Create only the speech / vocal stem.";
			case "instrumental":
				return "Create only the music / bed stem.";
			default:
				return "Create both stems and place them on fresh audio tracks.";
		}
	}, [outputMode]);

	const handleProcess = async () => {
		if (!mediaAsset?.file) {
			toast.error("No source audio available");
			return;
		}

		if (!status?.available) {
			toast.error("audio-separator is not available", {
				description:
					status?.installHint ??
					"Install with: pip install audio-separator[gpu]",
			});
			return;
		}

		if (!taskKey || !mediaAsset) {
			toast.error("No source audio available");
			return;
		}

		startTask({
			key: taskKey,
			title: "Separate Sound",
			tabId: "separate-sound",
			elementId: element.id,
			trackId,
			assetId: mediaAsset.id,
			message: "Running local separation now...",
			detail: `${outputMode} with ${modelName}`,
			progress: null,
			metadata: {
				lastOutputs,
			},
		});
		try {
			const formData = new FormData();
			formData.append("file", mediaAsset.file, mediaAsset.file.name);
			formData.append("modelName", modelName);
			formData.append("outputMode", outputMode);

			const response = await fetch("/api/audio/separate", {
				method: "POST",
				body: formData,
			});
			updateTask(taskKey, {
				message: "Importing separated stems into the timeline...",
			});

			if (!response.ok) {
				throw new Error((await response.text()) || "Sound separation failed");
			}

			const payload = (await response.json()) as { outputs: SeparateOutput[] };
			if (!payload.outputs?.length) {
				throw new Error("No separated stems were returned.");
			}

			const outputFiles = payload.outputs.map(
				(output) =>
					new File(
						[
							Uint8Array.from(atob(output.base64), (char) =>
								char.charCodeAt(0),
							),
						],
						output.filename,
						{
							type: output.mimeType,
							lastModified: Date.now(),
						},
					),
			);

			const processedAssets = await processMediaAssets({ files: outputFiles });
			if (processedAssets.length === 0) {
				throw new Error("Failed to process the separated stems.");
			}

			const createdAssets: MediaAsset[] = [];
			for (const asset of processedAssets) {
				const createdAsset = await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset,
				});
				if (createdAsset) {
					createdAssets.push(createdAsset);
				}
			}

			if (createdAssets.length === 0) {
				throw new Error("Failed to save separated stems.");
			}

			const stemTypeByName = new Map(
				payload.outputs.map((output) => [output.filename, output.stemType]),
			);

			const commands = createdAssets.flatMap((createdAsset) => {
				const addTrackCommand = new AddTrackCommand("audio");
				const insertTrackId = addTrackCommand.getTrackId();
				const insertElementCommand = new InsertElementCommand({
					element: buildElementFromMedia({
						mediaId: createdAsset.id,
						mediaType: createdAsset.type,
						name: createdAsset.name,
						duration: createdAsset.duration ?? element.duration,
						startTime: element.startTime,
					}),
					placement: {
						mode: "explicit",
						trackId: insertTrackId,
					},
				});
				return [addTrackCommand, insertElementCommand];
			});

			editor.command.execute({
				command: new BatchCommand(commands),
			});

			if (muteSourceAudio && element.type === "video") {
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

			const nextOutputs = createdAssets.map((asset) => ({
				id: asset.id,
				name: asset.name,
				stemType: stemTypeByName.get(asset.name) ?? "other",
			}));
			completeTask(taskKey, {
				message: "Separate sound completed",
				detail: `${createdAssets.length} stem(s) added to audio tracks.`,
				metadata: {
					lastOutputs: nextOutputs,
				},
			});
			toast.success("Separate sound completed", {
				description: `${createdAssets.length} stem(s) added to audio tracks.`,
			});
		} catch (error) {
			console.error(error);
			if (taskKey) {
				failTask(
					taskKey,
					"Separate sound failed",
					error instanceof Error ? error.message : "Unknown error",
				);
			}
			toast.error("Separate sound failed", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<Section collapsible sectionKey={`${element.id}:separate-sound`}>
			<SectionHeader>
				<SectionTitle>Separate Sound</SectionTitle>
			</SectionHeader>
			<SectionContent className="space-y-4">
				<div className="overflow-hidden rounded-xl border bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100">
					<div className="border-b border-white/10 px-4 py-3">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<div className="flex size-9 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
									<HugeiconsIcon icon={AiAudioIcon} size={18} />
								</div>
								<div>
									<div className="text-sm font-semibold">MDX Stem Split</div>
									<div className="text-xs text-slate-400">
										Local separation on this PC
									</div>
								</div>
							</div>
							<Badge
								variant={status?.available ? "secondary" : "outline"}
								className={cn(
									"border-white/10 bg-white/5 text-slate-200",
									status?.available && "bg-emerald-500/15 text-emerald-300",
								)}
							>
								{isLoadingStatus
									? "Checking"
									: status?.available
										? "Ready"
										: "Missing"}
							</Badge>
						</div>
					</div>
					<div className="space-y-3 px-4 py-4">
						<div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
							<div className="mt-0.5 text-slate-300">
								<HugeiconsIcon
									icon={
										mediaAsset?.type === "video" ? Video01Icon : MusicNote03Icon
									}
									size={16}
								/>
							</div>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium">{sourceInfo}</div>
								<div className="mt-1 text-xs text-slate-400">{sourceMeta}</div>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
								<div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">
									Engine
								</div>
								<div className="mt-1 text-sm font-medium">audio-separator</div>
							</div>
							<div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2">
								<div className="text-[10px] uppercase tracking-[0.18em] text-fuchsia-300/80">
									Default
								</div>
								<div className="mt-1 truncate text-sm font-medium">
									{modelName}
								</div>
							</div>
						</div>
						<div className="text-xs text-slate-400">
							{status?.available
								? getModelHint(modelName)
								: "Install the local separator once, then this panel runs entirely on the PC."}
						</div>
					</div>
				</div>

				<SectionFields>
					<SectionField label="Stem Mode">
						<div className="space-y-2">
							<ToggleGroup
								type="single"
								value={outputMode}
								onValueChange={(value) => {
									if (value) {
										setOutputMode(value as OutputMode);
									}
								}}
								variant="outline"
								className="grid grid-cols-3 gap-2"
							>
								<ToggleGroupItem value="both" className="h-auto px-3 py-2">
									<div className="text-left">
										<div className="text-xs font-semibold">Both</div>
										<div className="text-[10px] opacity-70">2 stems</div>
									</div>
								</ToggleGroupItem>
								<ToggleGroupItem value="vocals" className="h-auto px-3 py-2">
									<div className="text-left">
										<div className="text-xs font-semibold">Vocals</div>
										<div className="text-[10px] opacity-70">speech only</div>
									</div>
								</ToggleGroupItem>
								<ToggleGroupItem
									value="instrumental"
									className="h-auto px-3 py-2"
								>
									<div className="text-left">
										<div className="text-xs font-semibold">Music</div>
										<div className="text-[10px] opacity-70">bed only</div>
									</div>
								</ToggleGroupItem>
							</ToggleGroup>
							<div className="text-xs text-muted-foreground">
								{modeDescription}
							</div>
						</div>
					</SectionField>

					<SectionField label="Model">
						<Select value={modelName} onValueChange={setModelName}>
							<SelectTrigger className="bg-transparent">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(status?.models ?? []).map((model) => (
									<SelectItem key={model.id} value={model.id}>
										{model.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>

					{element.type === "video" ? (
						<SectionField label="Mute Source Audio">
							<div className="flex items-center justify-between rounded-lg border bg-accent/20 px-3 py-2.5">
								<div>
									<div className="text-sm font-medium">
										After stems are added
									</div>
									<div className="text-xs text-muted-foreground">
										Keep the timeline clean by disabling the original clip
										audio.
									</div>
								</div>
								<Switch
									checked={muteSourceAudio}
									onCheckedChange={setMuteSourceAudio}
								/>
							</div>
						</SectionField>
					) : null}
				</SectionFields>

				<div
					className={cn(
						"rounded-lg border px-3 py-3 text-sm",
						status?.available
							? "border-emerald-500/20 bg-emerald-500/5"
							: "border-dashed bg-muted/30",
					)}
				>
					<div className="flex items-center gap-2">
						<HugeiconsIcon icon={Mic01Icon} size={15} />
						<span className="font-medium">
							{status?.available
								? "Local separator connected"
								: "Local setup required"}
						</span>
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{status?.available
							? `Using ${status.binary}. Stems stay local until GSMEDIACUT imports them as project assets.`
							: (status?.installHint ??
								"Install with: pip install audio-separator[gpu]")}
					</div>
				</div>

				<div className="rounded-xl border bg-card">
					<div className="border-b px-3 py-2.5">
						<div className="text-sm font-semibold">Stem Deck</div>
						<div className="text-xs text-muted-foreground">
							{isProcessing
								? (task?.message ?? "Running local separation now...")
								: lastOutputs.length > 0
									? "Most recent stems imported into the timeline."
									: "Your separated stems will show up here after the run."}
						</div>
					</div>
					<div className="space-y-2 p-3">
						{lastOutputs.length > 0 ? (
							lastOutputs.map((output) => (
								<div
									key={output.id}
									className="flex items-center justify-between rounded-lg border bg-accent/20 px-3 py-2"
								>
									<div className="min-w-0">
										<div className="truncate text-sm font-medium">
											{output.name}
										</div>
										<div className="mt-1 text-xs text-muted-foreground">
											Imported as a new audio track
										</div>
									</div>
									<Badge
										variant="outline"
										className={cn(
											"ml-3 shrink-0",
											getStemTone(output.stemType),
										)}
									>
										{getStemLabel(output.stemType)}
									</Badge>
								</div>
							))
						) : (
							<div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
								Choose a mode, then click{" "}
								<span className="font-medium">Separate Sound</span>.
							</div>
						)}
					</div>
				</div>

				<Button
					onClick={handleProcess}
					disabled={!canSeparate || isLoadingStatus || isProcessing}
					className="h-11 w-full"
				>
					{isProcessing
						? "Separating..."
						: status?.available
							? "Separate Sound"
							: "Show Setup"}
				</Button>
			</SectionContent>
		</Section>
	);
}
