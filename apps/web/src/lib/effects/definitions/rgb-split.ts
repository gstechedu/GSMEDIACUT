import type { EffectDefinition } from "@/lib/effects/types";
import { parseNumberParam, percentToPixels } from "./shader-utils";

export const RGB_SPLIT_SHADER = "rgb-split";

export const rgbSplitEffectDefinition: EffectDefinition = {
	type: "rgb-split",
	name: "RGB Split",
	keywords: ["rgb", "split", "chromatic", "offset", "shadertoy"],
	params: [
		{
			key: "intensity",
			label: "Intensity",
			type: "number",
			default: 18,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "angle",
			label: "Angle",
			type: "number",
			default: 0,
			min: 0,
			max: 360,
			step: 1,
		},
	],
	renderer: {
		passes: [
			{
				shader: RGB_SPLIT_SHADER,
				uniforms: ({ effectParams, width }) => {
					const intensity = parseNumberParam({
						effectParams,
						key: "intensity",
						fallback: 18,
					});
					const angle = parseNumberParam({
						effectParams,
						key: "angle",
						fallback: 0,
					});

					return {
						u_amount: percentToPixels({
							intensity,
							width,
							basePixels: 2,
							widthRatio: 0.009,
						}),
						u_angle: (angle * Math.PI) / 180,
					};
				},
			},
		],
	},
};
