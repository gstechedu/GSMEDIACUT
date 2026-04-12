# GSMEDIACUT language support

GSMEDIACUT now bundles local Noto families for several complex-script and non-Latin writing systems so text editing does not depend on Google Fonts being reachable at runtime.

## Bundled local fonts

- `Noto Sans`
- `Noto Sans Khmer`
- `Noto Serif Khmer`
- `Noto Sans Thai`
- `Noto Naskh Arabic`
- `Noto Sans Devanagari`
- `Noto Sans SC`
- `Noto Sans JP`
- `Noto Sans KR`

These are loaded in `apps/web/src/app/layout.tsx` and treated as local fonts by the picker and project font loader.

## Current shaping behavior

- Browser text editing and canvas rendering now use a multilingual fallback stack.
- For many scripts, modern browser text shaping will already work correctly if the font supports the script.
- This does not yet mean export-grade HarfBuzz shaping is fully integrated as a dedicated text-layout pipeline.

## HarfBuzz status

- `harfbuzzjs` is installed in `apps/web`.
- It is not yet wired into the renderer/export path.
- When hard-burned caption rendering is implemented outside browser-native text layout, HarfBuzz should become the authoritative shaping stage.

## Khmer-specific notes

- Khmer fallback is now available even when the selected primary font lacks Khmer glyphs.
- If you want Khmer-only title presets, add them in `apps/web/src/data/gsm-studio.ts`.
- If you want to bundle Khmer OS fonts directly, use `vendor/khmer-unicode-fonts` as the source reference and ship approved files under their license terms.
