import { generateUUID } from "@/utils/id";
import { buildDefaultParamValues } from "@/lib/registry";
import { effectsRegistry } from "./registry";
import type { ParamValues } from "@/lib/params";
import type { Effect, EffectDefinition, EffectPass } from "@/lib/effects/types";
import { VISUAL_ELEMENT_TYPES } from "@/lib/timeline";

export { effectsRegistry } from "./registry";
export { registerDefaultEffects } from "./definitions";

export function resolveEffectPasses({
	definition,
	effectParams,
	width,
	height,
	timeSeconds = 0,
}: {
	definition: EffectDefinition;
	effectParams: ParamValues;
	width: number;
	height: number;
	timeSeconds?: number;
}): EffectPass[] {
	if (definition.renderer.buildPasses) {
		return definition.renderer
			.buildPasses({
				effectParams,
				width,
				height,
				timeSeconds,
			})
			.map((pass) => ({
				...pass,
				uniforms: {
					...pass.uniforms,
					u_time: timeSeconds,
				},
			}));
	}
	return definition.renderer.passes.map((pass) => ({
		shader: pass.shader,
		uniforms: {
			...pass.uniforms({ effectParams, width, height, timeSeconds }),
			u_time: timeSeconds,
		},
	}));
}

export const EFFECT_TARGET_ELEMENT_TYPES = VISUAL_ELEMENT_TYPES;

export function buildDefaultEffectInstance({
	effectType,
}: {
	effectType: string;
}): Effect {
	const definition = effectsRegistry.get(effectType);
	const params: ParamValues = buildDefaultParamValues(definition.params);

	return {
		id: generateUUID(),
		type: effectType,
		params,
		enabled: true,
	};
}
