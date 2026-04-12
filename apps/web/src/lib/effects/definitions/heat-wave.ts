import type { EffectDefinition } from "@/lib/effects/types";
import { parseNumberParam, percentToPixels } from "./shader-utils";

export const HEAT_WAVE_SHADER = "heat-wave";

export const heatWaveEffectDefinition: EffectDefinition = {
	type: "heat-wave",
	name: "Heat Wave",
	keywords: ["heat", "wave", "distortion", "mirage", "warp"],
	params: [
		{
			key: "amplitude",
			label: "Amplitude",
			type: "number",
			default: 20,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "frequency",
			label: "Frequency",
			type: "number",
			default: 42,
			min: 1,
			max: 100,
			step: 1,
		},
	],
	renderer: {
		passes: [
			{
				shader: HEAT_WAVE_SHADER,
				uniforms: ({ effectParams, width }) => {
					const amplitude = parseNumberParam({
						effectParams,
						key: "amplitude",
						fallback: 20,
					});
					const frequency = parseNumberParam({
						effectParams,
						key: "frequency",
						fallback: 42,
					});

					return {
						u_amplitude: percentToPixels({
							intensity: amplitude,
							width,
							basePixels: 2,
							widthRatio: 0.008,
						}),
						u_frequency: 0.4 + (frequency / 100) * 2.6,
					};
				},
			},
		],
	},
};
