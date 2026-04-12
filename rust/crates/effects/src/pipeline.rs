use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GPU_TEXTURE_FORMAT, GpuContext};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::{EffectPass, UniformValue};

const GAUSSIAN_BLUR_SHADER_ID: &str = "gaussian-blur";
const GAUSSIAN_BLUR_SHADER_SOURCE: &str = include_str!("shaders/gaussian_blur.wgsl");
const PRO_GLITCH_SHADER_ID: &str = "pro-glitch";
const PRO_GLITCH_SHADER_SOURCE: &str = include_str!("shaders/pro_glitch.wgsl");
const RGB_SPLIT_SHADER_ID: &str = "rgb-split";
const RGB_SPLIT_SHADER_SOURCE: &str = include_str!("shaders/rgb_split.wgsl");
const VHS_SHADER_ID: &str = "vhs";
const VHS_SHADER_SOURCE: &str = include_str!("shaders/vhs.wgsl");
const CRT_SHADER_ID: &str = "crt";
const CRT_SHADER_SOURCE: &str = include_str!("shaders/crt.wgsl");
const HEAT_WAVE_SHADER_ID: &str = "heat-wave";
const HEAT_WAVE_SHADER_SOURCE: &str = include_str!("shaders/heat_wave.wgsl");

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
}

pub struct EffectPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error("At least one effect pass is required")]
    MissingEffectPasses,
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
    #[error("Missing uniform '{uniform}' for shader '{shader}'")]
    MissingUniform { shader: String, uniform: String },
    #[error("Uniform '{uniform}' for shader '{shader}' must be a number")]
    InvalidNumberUniform { shader: String, uniform: String },
    #[error(
        "Uniform '{uniform}' for shader '{shader}' must be a vector of length {expected_length}"
    )]
    InvalidVectorUniform {
        shader: String,
        uniform: String,
        expected_length: usize,
    },
    #[error("Shader '{shader}' does not support uniform '{uniform}'")]
    UnsupportedUniform { shader: String, uniform: String },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct EffectUniformBuffer {
    resolution: [f32; 2],
    direction: [f32; 2],
    scalars: [f32; 4],
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let uniform_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-uniform-bind-group-layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    }],
                });
        let vertex_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-fullscreen-shader"),
                    source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
                });
        let gaussian_blur_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-gaussian-blur-shader"),
                    source: wgpu::ShaderSource::Wgsl(GAUSSIAN_BLUR_SHADER_SOURCE.into()),
                });
        let pro_glitch_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-pro-glitch-shader"),
                    source: wgpu::ShaderSource::Wgsl(PRO_GLITCH_SHADER_SOURCE.into()),
                });
        let rgb_split_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-rgb-split-shader"),
                    source: wgpu::ShaderSource::Wgsl(RGB_SPLIT_SHADER_SOURCE.into()),
                });
        let vhs_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-vhs-shader"),
                    source: wgpu::ShaderSource::Wgsl(VHS_SHADER_SOURCE.into()),
                });
        let crt_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-crt-shader"),
                    source: wgpu::ShaderSource::Wgsl(CRT_SHADER_SOURCE.into()),
                });
        let heat_wave_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-heat-wave-shader"),
                    source: wgpu::ShaderSource::Wgsl(HEAT_WAVE_SHADER_SOURCE.into()),
                });
        let pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        let gaussian_blur_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &gaussian_blur_shader_module,
            "effects-gaussian-blur-pipeline",
        );
        let pro_glitch_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &pro_glitch_shader_module,
            "effects-pro-glitch-pipeline",
        );
        let rgb_split_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &rgb_split_shader_module,
            "effects-rgb-split-pipeline",
        );
        let vhs_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &vhs_shader_module,
            "effects-vhs-pipeline",
        );
        let crt_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &crt_shader_module,
            "effects-crt-pipeline",
        );
        let heat_wave_pipeline = create_effect_render_pipeline(
            context,
            &pipeline_layout,
            &vertex_shader_module,
            &heat_wave_shader_module,
            "effects-heat-wave-pipeline",
        );
        let pipelines = HashMap::from([
            (GAUSSIAN_BLUR_SHADER_ID.to_string(), gaussian_blur_pipeline),
            (PRO_GLITCH_SHADER_ID.to_string(), pro_glitch_pipeline),
            (RGB_SPLIT_SHADER_ID.to_string(), rgb_split_pipeline),
            (VHS_SHADER_ID.to_string(), vhs_pipeline),
            (CRT_SHADER_ID.to_string(), crt_pipeline),
            (HEAT_WAVE_SHADER_ID.to_string(), heat_wave_pipeline),
        ]);

        Self {
            uniform_bind_group_layout,
            pipelines,
        }
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut current_texture: Option<wgpu::Texture> = None;

        for pass in passes {
            let input_texture = current_texture.as_ref().unwrap_or(source);
            let output_texture =
                context.create_render_texture(width, height, "effects-pass-output");
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let texture_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-texture-bind-group"),
                        layout: context.texture_sampler_bind_group_layout(),
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                            },
                        ],
                    });
            let uniform_buffer =
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("effects-uniform-buffer"),
                        contents: bytemuck::bytes_of(&pack_effect_uniforms(pass, width, height)?),
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    });
            let uniform_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-uniform-bind-group"),
                        layout: &self.uniform_bind_group_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform_buffer.as_entire_binding(),
                        }],
                    });
            let pipeline = self.pipelines.get(&pass.shader).ok_or_else(|| {
                EffectsError::UnknownEffectShader {
                    shader: pass.shader.clone(),
                }
            })?;
            let mut encoder =
                context
                    .device()
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("effects-command-encoder"),
                    });

            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    occlusion_query_set: None,
                    timestamp_writes: None,
                    multiview_mask: None,
                });
                render_pass.set_pipeline(pipeline);
                render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                render_pass.draw(0..6, 0..1);
            }

            context.queue().submit([encoder.finish()]);
            current_texture = Some(output_texture);
        }

        current_texture.ok_or(EffectsError::MissingEffectPasses)
    }
}

fn pack_effect_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let shader = pass.shader.as_str();
    match shader {
        GAUSSIAN_BLUR_SHADER_ID => pack_gaussian_blur_uniforms(pass, width, height),
        PRO_GLITCH_SHADER_ID => pack_pro_glitch_uniforms(pass, width, height),
        RGB_SPLIT_SHADER_ID => pack_rgb_split_uniforms(pass, width, height),
        VHS_SHADER_ID => pack_vhs_uniforms(pass, width, height),
        CRT_SHADER_ID => pack_crt_uniforms(pass, width, height),
        HEAT_WAVE_SHADER_ID => pack_heat_wave_uniforms(pass, width, height),
        _ => Err(EffectsError::UnknownEffectShader {
            shader: shader.to_string(),
        }),
    }
}

fn pack_gaussian_blur_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let sigma = read_number_uniform(pass, "u_sigma")?;
    let step = read_number_uniform(pass, "u_step")?;
    let direction = read_vec2_uniform(pass, "u_direction")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_sigma"
            || uniform == "u_step"
            || uniform == "u_direction"
            || uniform == "u_time"
        {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction,
        scalars: [sigma, step, time, 0.0],
    })
}

fn pack_pro_glitch_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let amount = read_number_uniform(pass, "u_amount")?;
    let scanlines = read_number_uniform(pass, "u_scanlines")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_amount" || uniform == "u_scanlines" || uniform == "u_time" {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [0.0, 0.0],
        scalars: [amount, scanlines, time, 0.0],
    })
}

fn pack_rgb_split_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let amount = read_number_uniform(pass, "u_amount")?;
    let angle = read_number_uniform(pass, "u_angle")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_amount" || uniform == "u_angle" || uniform == "u_time" {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [0.0, 0.0],
        scalars: [amount, angle, time, 0.0],
    })
}

fn pack_vhs_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let distortion = read_number_uniform(pass, "u_distortion")?;
    let noise = read_number_uniform(pass, "u_noise")?;
    let scanlines = read_number_uniform(pass, "u_scanlines")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_distortion"
            || uniform == "u_noise"
            || uniform == "u_scanlines"
            || uniform == "u_time"
        {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [0.0, 0.0],
        scalars: [distortion, noise, scanlines, time],
    })
}

fn pack_crt_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let curvature = read_number_uniform(pass, "u_curvature")?;
    let vignette = read_number_uniform(pass, "u_vignette")?;
    let scanlines = read_number_uniform(pass, "u_scanlines")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_curvature"
            || uniform == "u_vignette"
            || uniform == "u_scanlines"
            || uniform == "u_time"
        {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [0.0, 0.0],
        scalars: [curvature, vignette, scanlines, time],
    })
}

fn pack_heat_wave_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let amplitude = read_number_uniform(pass, "u_amplitude")?;
    let frequency = read_number_uniform(pass, "u_frequency")?;
    let time = read_optional_number_uniform(pass, "u_time")?.unwrap_or(0.0);

    for uniform in pass.uniforms.keys() {
        if uniform == "u_amplitude" || uniform == "u_frequency" || uniform == "u_time" {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [0.0, 0.0],
        scalars: [amplitude, frequency, time, 0.0],
    })
}

fn read_number_uniform(pass: &EffectPass, uniform: &str) -> Result<f32, EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    match value {
        UniformValue::Number(value) => Ok(*value),
        UniformValue::Vector(_) => Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        }),
    }
}

fn read_optional_number_uniform(
    pass: &EffectPass,
    uniform: &str,
) -> Result<Option<f32>, EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Ok(None);
    };
    match value {
        UniformValue::Number(value) => Ok(Some(*value)),
        UniformValue::Vector(_) => Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        }),
    }
}

fn create_effect_render_pipeline(
    context: &GpuContext,
    pipeline_layout: &wgpu::PipelineLayout,
    vertex_shader_module: &wgpu::ShaderModule,
    fragment_shader_module: &wgpu::ShaderModule,
    label: &'static str,
) -> wgpu::RenderPipeline {
    context
        .device()
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(pipeline_layout),
            vertex: wgpu::VertexState {
                module: vertex_shader_module,
                entry_point: Some("vertex_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x2,
                        offset: 0,
                        shader_location: 0,
                    }],
                }],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: fragment_shader_module,
                entry_point: Some("fragment_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: GPU_TEXTURE_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        })
}

fn read_vec2_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 2], EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    };
    if values.len() != 2 {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    }
    Ok([values[0], values[1]])
}
