# GSMEDIACUT feature integration plan

This repo now uses OpenCut as the base editor. The external repositories below are support libraries or reference implementations, not drop-in "make it CapCut" modules. Treat them as integration inputs.

## Base application

- OpenCut: primary editor shell, timeline UI, preview, asset panels, web app, and desktop shell
- Main code areas:
  - `apps/web/src/components/editor/`
  - `apps/web/src/lib/`
  - `apps/web/src/stores/`
  - `apps/desktop/`

## Recommended integration order

1. Get OpenCut running locally.
2. Verify the existing timeline, keyframe, waveform, and export systems.
3. Add reusable caption style presets.
4. Add animated stickers.
5. Add transition preset plumbing.
6. Add offline transcription.
7. Add speed-ramping and stabilization architecture.
8. Add background removal architecture.
9. Add desktop packaging polish.
10. Evaluate watermark-removal as a separate optional feature.

## Repo mapping

### Captions and text styles

- Repo: `vendor/ScriptGen`
- Use for:
  - subtitle timing ideas
  - animated text style references
  - preset naming and UX patterns
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/assets/views/captions.tsx`
  - `apps/web/src/components/editor/panels/assets/views/text.tsx`
  - `apps/web/src/components/editor/panels/properties/tabs/text-tab.tsx`
  - `apps/web/src/lib/text/`

### Alternate caption styling reference

- Repo: `vendor/PyCaps`
- Use for:
  - subtitle CSS ideas
  - template styling references for readable caption treatments
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/assets/views/captions.tsx`
  - `apps/web/src/components/editor/panels/assets/views/text.tsx`
  - future caption preset theme files

### Animated stickers

- Repos:
  - `vendor/lottie-web`
  - `vendor/lottie-react`
  - `vendor/Lottie-Windows`
- Use for:
  - JSON sticker playback
  - animated subscribe arrows, sparkles, badges, icons
  - Windows-native playback reference for desktop packaging
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/assets/views/stickers.tsx`
  - `apps/web/src/stores/stickers-store.ts`
  - `apps/web/src/components/editor/panels/preview/`

### Transitions and effects

- Repos:
  - `vendor/gl-transitions`
  - `vendor/ffmpeg-gl-transition`
- Use for:
  - transition shader catalog
  - preset metadata and previews
  - FFmpeg-backed transition rendering references
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/assets/views/effects.tsx`
  - `apps/web/src/components/editor/panels/properties/tabs/effects-tab.tsx`
  - `docs/effects-renderer.md`
  - `apps/web/src/services/renderer/` once export rendering is extended for transition shaders

### Speed ramping and interpolation

- Repo: `vendor/RIFE`
- Use for:
  - frame interpolation for smoother slow motion
  - future desktop-side or backend-assisted speed ramp rendering
- OpenCut status:
  - base speed controls already exist in the properties panel
  - smooth AI interpolation is not integrated
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/properties/tabs/speed-tab.tsx`
  - `apps/web/src/services/renderer/`
  - `apps/desktop/` or a separate local service for heavy inference

### Background removal and chroma-style subject isolation

- Repo: `vendor/RobustVideoMatting`
- Use for:
  - subject matting for portrait clips
  - one-click cutout workflow before compositing
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/properties/tabs/`
  - `apps/web/src/components/editor/panels/preview/`
  - `apps/web/src/services/renderer/`
  - likely `apps/desktop/` or a local Python service because browser-only inference will be too heavy for practical editing

### Keyframe and motion tooling

- Repo: `vendor/Theatre`
- Use for:
  - reference UI/UX and motion editing ideas
  - optional future replacement or augmentation of animation tooling
- OpenCut status:
  - OpenCut already includes a native keyframe system, timeline diamonds, curve editing, and graph tools
  - Theatre is not required for basic keyframe support
- Existing OpenCut areas:
  - `apps/web/src/lib/animation/`
  - `apps/web/src/components/editor/panels/timeline/graph-editor/`
  - `apps/web/src/hooks/timeline/element/use-keyframe-drag.ts`

### Stabilization

- Repo: `vendor/vid.stab`
- Use for:
  - FFmpeg-based video stabilization during processing/export
- OpenCut integration points:
  - export and processing pipeline
  - desktop/native packaging path if browser-only FFmpeg constraints are too restrictive

### Audio tooling

- Repo: `vendor/Remotion`
- Use for:
  - caption and media workflow references
  - `@remotion/openai-whisper` package lineage for whisper/remotion-style caption flows
- OpenCut status:
  - waveform rendering is already present in the editor
  - `wavesurfer.js` is already a dependency in `apps/web/package.json`
  - audio ducking and volume-envelope UX are not built yet
- OpenCut integration points:
  - `apps/web/src/components/editor/panels/timeline/audio-waveform.tsx`
  - `apps/web/src/components/editor/panels/properties/tabs/audio-tab.tsx`
  - `apps/web/src/lib/timeline/audio-state.ts`

### Offline speech to text

- Repo: `vendor/whisper.cpp`
- Use for:
  - offline transcription on Windows and Android
  - future desktop-native caption generation
- OpenCut integration points:
  - `apps/web/src/lib/transcription/`
  - `apps/web/src/services/transcription/`
  - `apps/desktop/` for native bindings or process execution

### UI panel ideas

- Repo: `vendor/twick`
- Use for:
  - panel layout references
  - modular timeline/editor ergonomics
- OpenCut integration points:
  - `apps/web/src/components/editor/`
  - `apps/web/src/components/ui/`

### Optional watermark removal

- Repos:
  - `vendor/WatermarkRemover-AI`
  - `vendor/VeoWatermarkRemover`
- Use for:
  - standalone preprocessing tool or separate export cleanup workflow
- Recommendation:
  - keep this outside the core editor path first
  - add it later as an opt-in desktop-only feature because it will complicate runtime requirements

## Practical constraints

- OpenCut already provides a serious foundation, but it is not feature-complete parity with CapCut.
- OpenCut already ships with keyframe infrastructure and waveform rendering, so those are enhancement areas rather than blank-slate features.
- External repos use different stacks and licenses. Integration needs code review, adaptation, and license compliance.
- Some repos are best used as references or isolated services instead of direct source copies.
- A few names from the research list do not map cleanly to one stable public GitHub repository, so this plan tracks the verified upstream repos instead.
- Android packaging is not present in this repo yet. If mobile is required, decide whether to add Capacitor around `apps/web` or build a dedicated mobile wrapper later.
- A Python/FastAPI sidecar is reasonable for heavy AI on desktop, but it conflicts with a strict "single fully offline mobile package" goal unless you also ship on-device models separately.
