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
    let amount = uniforms.scalars.x;
    let scanlines = uniforms.scalars.y;
    let time = uniforms.scalars.z;

    let wave = sin(input.tex_coord.y * uniforms.resolution.y * 0.125 + time * 7.5) * amount * 0.5;
    let curve = sin(input.tex_coord.y * uniforms.resolution.y * 0.42 - time * 5.0) * amount * 0.25;
    let total_offset = vec2f((wave + curve) * texel_size.x, 0.0);
    let burst = 0.5 + 0.5 * sin(time * 8.0);
    let channel_offset = vec2f(amount * burst * texel_size.x, 0.0);

    let red = textureSample(input_texture, input_sampler, input.tex_coord + total_offset + channel_offset);
    let green = textureSample(input_texture, input_sampler, input.tex_coord + total_offset * 0.25);
    let blue = textureSample(input_texture, input_sampler, input.tex_coord + total_offset - channel_offset);

    var color = vec4f(red.r, green.g, blue.b, green.a);

    let scan = 0.92 + 0.08 * sin(input.tex_coord.y * uniforms.resolution.y * 1.35 + time * 10.0);
    color.rgb = color.rgb * mix(1.0, scan, scanlines);

    return color;
}
