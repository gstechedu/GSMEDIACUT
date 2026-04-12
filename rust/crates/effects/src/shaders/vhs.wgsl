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

fn hash2(p: vec2f) -> f32 {
    let h = dot(p, vec2f(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel_size = vec2f(1.0, 1.0) / uniforms.resolution;
    let distortion = uniforms.scalars.x;
    let noise = uniforms.scalars.y;
    let scanlines = uniforms.scalars.z;
    let time = uniforms.scalars.w;

    let line_wave = sin(input.tex_coord.y * uniforms.resolution.y * 0.14 + time * 8.0) * distortion;
    let band_wave = sin(input.tex_coord.y * uniforms.resolution.y * 0.035 - time * 3.0) * distortion * 0.6;
    let offset = vec2f((line_wave + band_wave) * texel_size.x, 0.0);

    var color = textureSample(input_texture, input_sampler, input.tex_coord + offset);

    let grain_uv = input.tex_coord * uniforms.resolution * 0.5 + vec2f(time * 37.0, time * 19.0);
    let grain = (hash2(grain_uv) - 0.5) * noise * 0.22;
    let scan = 1.0 - scanlines * (0.08 + 0.08 * sin(input.tex_coord.y * uniforms.resolution.y * 1.4 + time * 12.0));

    color.rgb = (color.rgb + grain) * scan;
    color.r = textureSample(input_texture, input_sampler, input.tex_coord + offset + vec2f(1.5 * texel_size.x, 0.0)).r;
    color.b = textureSample(input_texture, input_sampler, input.tex_coord + offset - vec2f(1.5 * texel_size.x, 0.0)).b;

    return color;
}
