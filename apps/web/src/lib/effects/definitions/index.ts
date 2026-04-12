import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { crtEffectDefinition } from "./crt";
import { heatWaveEffectDefinition } from "./heat-wave";
import { proGlitchEffectDefinition } from "./pro-glitch";
import { rgbSplitEffectDefinition } from "./rgb-split";
import { vhsEffectDefinition } from "./vhs";

const defaultEffects = [
	blurEffectDefinition,
	proGlitchEffectDefinition,
	rgbSplitEffectDefinition,
	vhsEffectDefinition,
	crtEffectDefinition,
	heatWaveEffectDefinition,
];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register(definition.type, definition);
	}
}
