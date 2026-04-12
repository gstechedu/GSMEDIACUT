import type { EffectDefinition } from "@/lib/effects/types";
import { parseNumberParam, percentToPixels } from "./shader-utils";

export const PRO_GLITCH_SHADER = "pro-glitch";

export const proGlitchEffectDefinition: EffectDefinition = {
	type: "pro-glitch",
	name: "Pro Glitch",
	keywords: ["glitch", "rgb", "split", "chromatic", "shadertoy"],
	params: [
		{
			key: "intensity",
			label: "Intensity",
			type: "number",
			default: 24,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "scanlines",
			label: "Scanlines",
			type: "number",
			default: 35,
			min: 0,
			max: 100,
			step: 1,
		},
	],
	renderer: {
		passes: [
			{
				shader: PRO_GLITCH_SHADER,
				uniforms: ({ effectParams, width }) => {
					const intensity = parseNumberParam({
						effectParams,
						key: "intensity",
						fallback: 24,
					});
					const scanlines = parseNumberParam({
						effectParams,
						key: "scanlines",
						fallback: 35,
					});
					const pixelOffset = percentToPixels({
						intensity,
						width,
						basePixels: 4,
						widthRatio: 0.012,
					});

					return {
						u_amount: pixelOffset,
						u_scanlines: scanlines / 100,
					};
				},
			},
		],
	},
};
