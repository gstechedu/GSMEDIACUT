import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/hooks/use-editor";
import { DEFAULTS } from "@/lib/timeline/defaults";
import { buildTextElement } from "@/lib/timeline/element-utils";
import { TEXT_STYLE_PRESETS } from "@/data/gsm-studio";

export function TextView() {
	const editor = useEditor();

	const handleAddToTimeline = ({
		currentTime,
		presetId,
	}: {
		currentTime: number;
		presetId?: string;
	}) => {
		const activeScene = editor.scenes.getActiveScene();
		if (!activeScene) return;

		const preset = TEXT_STYLE_PRESETS.find((item) => item.id === presetId);
		const element = buildTextElement({
			raw: preset
				? {
						...DEFAULTS.text.element,
						name: preset.name,
						content: preset.content,
						fontSize: preset.fontSize,
						fontFamily: preset.fontFamily,
						color: preset.color,
						fontWeight: preset.fontWeight,
						fontStyle: preset.fontStyle,
						textDecoration: preset.textDecoration,
						letterSpacing: preset.letterSpacing,
						lineHeight: preset.lineHeight,
						background: preset.background ?? DEFAULTS.text.element.background,
					}
				: DEFAULTS.text.element,
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<PanelView title="Text">
			<div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}>
				<DraggableItem
					name="Default text"
					preview={
						<div className="bg-accent flex size-full items-center justify-center rounded">
							<span className="text-xs select-none">Default</span>
						</div>
					}
					dragData={{
						id: "temp-text-id",
						type: DEFAULTS.text.element.type,
						name: DEFAULTS.text.element.name,
						content: DEFAULTS.text.element.content,
					}}
					aspectRatio={1}
					onAddToTimeline={({ currentTime }) => handleAddToTimeline({ currentTime })}
					shouldShowLabel={false}
				/>
				{TEXT_STYLE_PRESETS.map((preset) => (
					<DraggableItem
						key={preset.id}
						name={preset.name}
						preview={
							<div
								className="flex size-full items-center justify-center p-2 text-center"
								style={{
									background: preset.background?.enabled
										? preset.background.color
										: "#111827",
									color: preset.color,
								}}
							>
								<span className="text-xs font-bold select-none">
									{preset.preview}
								</span>
							</div>
						}
						dragData={{
							id: `text-${preset.id}`,
							type: "text",
							name: preset.name,
							content: preset.content,
						}}
						aspectRatio={1}
						onAddToTimeline={({ currentTime }) =>
							handleAddToTimeline({ currentTime, presetId: preset.id })
						}
						shouldShowLabel={false}
						isDraggable={false}
					/>
				))}
			</div>
		</PanelView>
	);
}
