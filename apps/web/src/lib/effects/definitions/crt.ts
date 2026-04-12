import type { EffectDefinition } from "@/lib/effects/types";
import { parseNumberParam } from "./shader-utils";

export const CRT_SHADER = "crt";

export const crtEffectDefinition: EffectDefinition = {
	type: "crt",
	name: "CRT",
	keywords: ["crt", "scanline", "vignette", "screen", "retro"],
	params: [
		{
			key: "curvature",
			label: "Curvature",
			type: "number",
			default: 30,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "vignette",
			label: "Vignette",
			type: "number",
			default: 38,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "scanlines",
			label: "Scanlines",
			type: "number",
			default: 48,
			min: 0,
			max: 100,
			step: 1,
		},
	],
	renderer: {
		passes: [
			{
				shader: CRT_SHADER,
				uniforms: ({ effectParams }) => {
					const curvature = parseNumberParam({
						effectParams,
						key: "curvature",
						fallback: 30,
					});
					const vignette = parseNumberParam({
						effectParams,
						key: "vignette",
						fallback: 38,
					});
					const scanlines = parseNumberParam({
						effectParams,
						key: "scanlines",
						fallback: 48,
					});

					return {
						u_curvature: curvature / 250,
						u_vignette: vignette / 100,
						u_scanlines: scanlines / 100,
					};
				},
			},
		],
	},
};
