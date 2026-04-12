struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let curvature = uniforms.scalars.x;
    let vignette = uniforms.scalars.y;
    let scanlines = uniforms.scalars.z;
    let time = uniforms.scalars.w;

    var uv = input.tex_coord * 2.0 - vec2f(1.0, 1.0);
    let radius = dot(uv, uv);
    uv = uv + uv * radius * curvature;
    let sample_uv = uv * 0.5 + vec2f(0.5, 0.5);

    if (any(sample_uv < vec2f(0.0, 0.0)) || any(sample_uv > vec2f(1.0, 1.0))) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    var color = textureSample(input_texture, input_sampler, sample_uv);
    let vignette_strength = 1.0 - vignette * radius;
    let scan = 1.0 - scanlines * (0.06 + 0.06 * sin(sample_uv.y * uniforms.resolution.y * 1.5 + time * 9.0));
    let flicker = 0.985 + 0.015 * sin(time * 14.0);

    color.rgb = color.rgb * vignette_strength * scan * flicker;
    return color;
}
