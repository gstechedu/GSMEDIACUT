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
    let texel_size = vec2f(1.0, 1.0) / uniforms.resolution;
    let amplitude = uniforms.scalars.x;
    let frequency = uniforms.scalars.y;
    let time = uniforms.scalars.z;

    let x_wave = sin(input.tex_coord.y * uniforms.resolution.y * 0.02 * frequency + time * 2.4) * amplitude;
    let y_wave = cos(input.tex_coord.x * uniforms.resolution.x * 0.012 * frequency - time * 1.8) * amplitude * 0.35;
    let offset = vec2f(x_wave * texel_size.x, y_wave * texel_size.y);

    return textureSample(input_texture, input_sampler, input.tex_coord + offset);
}
