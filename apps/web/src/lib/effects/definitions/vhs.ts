import type { EffectDefinition } from "@/lib/effects/types";
import { parseNumberParam, percentToPixels } from "./shader-utils";

export const VHS_SHADER = "vhs";

export const vhsEffectDefinition: EffectDefinition = {
	type: "vhs",
	name: "VHS",
	keywords: ["vhs", "retro", "analog", "tape", "noise"],
	params: [
		{
			key: "distortion",
			label: "Distortion",
			type: "number",
			default: 28,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "noise",
			label: "Noise",
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
			default: 52,
			min: 0,
			max: 100,
			step: 1,
		},
	],
	renderer: {
		passes: [
			{
				shader: VHS_SHADER,
				uniforms: ({ effectParams, width }) => {
					const distortion = parseNumberParam({
						effectParams,
						key: "distortion",
						fallback: 28,
					});
					const noise = parseNumberParam({
						effectParams,
						key: "noise",
						fallback: 24,
					});
					const scanlines = parseNumberParam({
						effectParams,
						key: "scanlines",
						fallback: 52,
					});

					return {
						u_distortion: percentToPixels({
							intensity: distortion,
							width,
							basePixels: 3,
							widthRatio: 0.01,
						}),
						u_noise: noise / 100,
						u_scanlines: scanlines / 100,
					};
				},
			},
		],
	},
};
