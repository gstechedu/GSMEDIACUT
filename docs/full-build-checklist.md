# GSMEDIACUT full build checklist

This is the practical feature checklist for turning the current OpenCut-based app into a more complete short-form editor.

## Already present in the base

- Timeline editing and drag/drop media
- Multi-track layout
- Text elements
- Caption generation flow in the browser
- Effects panel foundation
- Export UI and renderer entry points
- Keyframe infrastructure and graph editor
- Audio waveform rendering foundation
- Local bundled multilingual font families and script-aware fallback stacks

## Integrated locally as reference repos

- `vendor/lottie-web`
- `vendor/khmer-unicode-fonts`
- `vendor/lottie-react`
- `vendor/Lottie-Windows`
- `vendor/gl-transitions`
- `vendor/ffmpeg-gl-transition`
- `vendor/whisper.cpp`
- `vendor/ScriptGen`
- `vendor/PyCaps`
- `vendor/harfbuzzjs`
- `vendor/twick`
- `vendor/WatermarkRemover-AI`
- `vendor/VeoWatermarkRemover`
- `vendor/RIFE`
- `vendor/RobustVideoMatting`
- `vendor/Theatre`
- `vendor/vid.stab`
- `vendor/Remotion`

## Still missing at runtime

### Visual editing

- Lottie playback inside the preview canvas
- Transition selection attached to actual clip-to-clip render metadata
- FFmpeg transition rendering integration
- Filter and adjustment workflows beyond placeholders
- Real caption motion presets instead of static style presets only
- Export-grade HarfBuzz text shaping integration

### Motion and retiming

- Speed ramp UI tied to frame interpolation
- Optical-flow or AI-assisted smooth slow motion
- Stabilize button in processing/export

### AI processing

- Robust background removal workflow
- Watermark removal as an explicit tool flow
- Native `whisper.cpp` desktop integration for offline transcription beyond browser models

### Audio

- Volume envelopes
- Auto ducking
- Better mixer controls

### Packaging and offline

- Bun/toolchain setup on this machine
- Desktop build verification
- Mobile wrapper decision and implementation
- License/attribution page for bundled codecs and third-party tools

## Architecture guidance

- Keep `apps/web` as the main editor UI.
- Use desktop-native or sidecar processing for heavy AI tasks such as RIFE and RobustVideoMatting.
- Treat Theatre as optional because OpenCut already has keyframes.
- Treat `wavesurfer.js` as an enhancement path for mixer UX, not as the first step.
- Treat unresolved repo names from notes as research leads until they map to stable upstream sources.

## Recommended next order

1. Install Bun and run the editor locally.
2. Add real Lottie sticker playback in preview.
3. Add transition metadata to timeline elements and export settings.
4. Add audio envelope UI.
5. Add stabilization in export/processing.
6. Add desktop-side whisper.cpp integration.
7. Add background removal and interpolation as separate heavy-processing workflows.
