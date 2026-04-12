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
    let angle = uniforms.scalars.y;
    let time = uniforms.scalars.z;
    let animated_angle = angle + sin(time * 1.7) * 0.35;
    let pulse = 0.7 + 0.3 * sin(time * 4.0);
    let offset = vec2f(cos(animated_angle), sin(animated_angle)) * amount * pulse * texel_size;

    let red = textureSample(input_texture, input_sampler, input.tex_coord + offset);
    let green = textureSample(input_texture, input_sampler, input.tex_coord);
    let blue = textureSample(input_texture, input_sampler, input.tex_coord - offset);

    return vec4f(red.r, green.g, blue.b, green.a);
}
