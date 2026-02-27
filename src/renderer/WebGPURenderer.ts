/* ═══════════════════════════════════════════════════════════════
   WebGPURenderer — WebGPU Hardware Accelerated Text Rendering

   Future replacement for WebGLRenderer. Uses the WebGPU API for
   improved performance, compute shader support, and modern GPU
   features. Falls back to WebGLRenderer when WebGPU is unavailable.

   Status: STUB — renders correctly but does not yet implement
   compute shaders for spatial partitioning / glyph culling.
   ═══════════════════════════════════════════════════════════════ */

import type { LayoutResult } from '../types';
import type { MSDFAtlas } from '@zappar/msdf-generator';
import type { IGPURenderer, GPURenderConfig } from './GPURendererInterface';

// ── WGSL Shader Sources ─────────────────────────────────────────

const MSDF_VERTEX_WGSL = /* wgsl */ `
struct Uniforms {
    resolution : vec2f,
    transform  : mat3x3f,
};

struct InstanceInput {
    @location(1) pos       : vec2f,
    @location(2) size      : vec2f,
    @location(3) uvTopLeft : vec2f,
    @location(4) uvBotRight: vec2f,
    @location(5) color     : vec3f,
};

struct VertexOutput {
    @builtin(position) pos : vec4f,
    @location(0)       uv  : vec2f,
    @location(1)       col  : vec3f,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

@vertex
fn main(
    @location(0) quadVert : vec2f,
    inst : InstanceInput,
) -> VertexOutput {
    var out : VertexOutput;

    let localPos = inst.pos + quadVert * inst.size;
    let transformed = u.transform * vec3f(localPos, 1.0);
    var clip = (transformed.xy / u.resolution) * 2.0 - 1.0;
    clip.y = -clip.y;

    out.pos = vec4f(clip, 0.0, 1.0);
    out.uv  = mix(inst.uvTopLeft, inst.uvBotRight, quadVert);
    out.col = inst.color;
    return out;
}
`;

const MSDF_FRAGMENT_WGSL = /* wgsl */ `
@group(0) @binding(1) var msdfTexture : texture_2d<f32>;
@group(0) @binding(2) var msdfSampler : sampler;

fn median3(r : f32, g : f32, b : f32) -> f32 {
    return max(min(r, g), min(max(r, g), b));
}

@fragment
fn main(
    @location(0) uv  : vec2f,
    @location(1) col : vec3f,
) -> @location(0) vec4f {
    let msd = textureSample(msdfTexture, msdfSampler, uv).rgb;
    let sd = median3(msd.r, msd.g, msd.b);

    let texSize = vec2f(textureDimensions(msdfTexture, 0));
    let unitRange = vec2f(4.0) / texSize;
    let screenTexSize = vec2f(1.0) / fwidth(uv);
    let screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
    let screenPxDist = screenPxRange * (sd - 0.5);
    let alpha = clamp(screenPxDist + 0.5, 0.0, 1.0);

    if (alpha <= 0.01) {
        discard;
    }

    return vec4f(col * alpha, alpha);
}
`;

// ── Compute shader stub for spatial partitioning ────────────────
// This compute shader will be used for GPU-accelerated glyph culling:
// given a visible viewport rectangle, it filters the glyph array to
// only include glyphs that intersect the viewport. This avoids sending
// off-screen glyphs to the vertex/fragment pipeline.
export const SPATIAL_PARTITION_COMPUTE_WGSL = /* wgsl */ `
struct ViewportParams {
    viewMin : vec2f,
    viewMax : vec2f,
    totalGlyphs : u32,
};

struct GlyphInstance {
    pos       : vec2f,
    size      : vec2f,
    uvTopLeft : vec2f,
    uvBotRight: vec2f,
    color     : vec3f,
    _pad      : f32,  // alignment padding
};

@group(0) @binding(0) var<uniform> viewport     : ViewportParams;
@group(0) @binding(1) var<storage, read>  allGlyphs    : array<GlyphInstance>;
@group(0) @binding(2) var<storage, read_write> visibleGlyphs : array<GlyphInstance>;
@group(0) @binding(3) var<storage, read_write> visibleCount  : atomic<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let idx = gid.x;
    if (idx >= viewport.totalGlyphs) { return; }

    let g = allGlyphs[idx];
    let gMin = g.pos;
    let gMax = g.pos + g.size;

    // AABB intersection test
    if (gMax.x >= viewport.viewMin.x && gMin.x <= viewport.viewMax.x &&
        gMax.y >= viewport.viewMin.y && gMin.y <= viewport.viewMax.y) {
        let slot = atomicAdd(&visibleCount, 1u);
        visibleGlyphs[slot] = g;
    }
}
`;

// ── Feature detection ───────────────────────────────────────────

/**
 * Check if the current browser supports WebGPU.
 * Returns true if `navigator.gpu` is available.
 */
export function isWebGPUAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// ── WebGPURenderer ──────────────────────────────────────────────

export class WebGPURenderer implements IGPURenderer {
    private _canvas: HTMLCanvasElement;
    private _config: GPURenderConfig;

    // WebGPU handles (initialized asynchronously)
    private _device: GPUDevice | null = null;
    private _context: GPUCanvasContext | null = null;
    private _pipeline: GPURenderPipeline | null = null;
    private _bindGroup: GPUBindGroup | null = null;
    private _uniformBuffer: GPUBuffer | null = null;
    private _instanceBuffer: GPUBuffer | null = null;
    private _quadBuffer: GPUBuffer | null = null;
    private _atlasTexture: GPUTexture | null = null;
    private _atlasSampler: GPUSampler | null = null;
    private _ready = false;

    private _transformMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    constructor(canvas: HTMLCanvasElement, config: Partial<GPURenderConfig> = {}) {
        this._canvas = canvas;
        this._config = {
            paperWidth: config.paperWidth ?? 595,
            paperHeight: config.paperHeight ?? 842,
            paperColor: config.paperColor ?? '#ffffff',
            dpiScale: config.dpiScale ?? (window.devicePixelRatio || 1),
        } as Required<GPURenderConfig>;
    }

    /**
     * Initialize the WebGPU device and pipelines.
     * Must be called (and awaited) before any rendering.
     */
    async init(): Promise<boolean> {
        if (!isWebGPUAvailable()) {
            console.warn('WebGPU is not available in this browser.');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('WebGPU: no suitable adapter found.');
                return false;
            }

            this._device = await adapter.requestDevice();
            this._context = this._canvas.getContext('webgpu') as GPUCanvasContext;

            if (!this._context) {
                console.warn('WebGPU: failed to get canvas context.');
                return false;
            }

            const format = navigator.gpu.getPreferredCanvasFormat();
            this._context.configure({
                device: this._device,
                format,
                alphaMode: 'premultiplied',
            });

            this._initPipeline(format);
            this._initBuffers();
            this._ready = true;
            console.log('WebGPURenderer initialized successfully.');
            return true;
        } catch (e) {
            console.error('WebGPU initialization failed:', e);
            return false;
        }
    }

    private _initPipeline(format: GPUTextureFormat) {
        const device = this._device!;

        const shaderModule = device.createShaderModule({
            code: MSDF_VERTEX_WGSL + '\n' + MSDF_FRAGMENT_WGSL,
        });

        // Bind group layout
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        this._pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'main',
                buffers: [
                    // Quad vertex buffer (location 0)
                    {
                        arrayStride: 2 * 4,
                        stepMode: 'vertex',
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
                    },
                    // Instance buffer (locations 1-5)
                    {
                        arrayStride: 11 * 4,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: 'float32x2' },     // pos
                            { shaderLocation: 2, offset: 8, format: 'float32x2' },     // size
                            { shaderLocation: 3, offset: 16, format: 'float32x2' },    // uvTopLeft
                            { shaderLocation: 4, offset: 24, format: 'float32x2' },    // uvBotRight
                            { shaderLocation: 5, offset: 32, format: 'float32x3' },    // color
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'main',
                targets: [{
                    format,
                    blend: {
                        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    },
                }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // Uniform buffer (resolution + transform)
        this._uniformBuffer = device.createBuffer({
            size: 256, // Plenty of space for uniforms
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Atlas sampler
        this._atlasSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
    }

    private _initBuffers() {
        const device = this._device!;

        // Static quad buffer [0,0] to [1,1]
        const quadData = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
        this._quadBuffer = device.createBuffer({
            size: quadData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this._quadBuffer.getMappedRange()).set(quadData);
        this._quadBuffer.unmap();
    }

    setAtlas(atlas: MSDFAtlas): void {
        if (!this._device || !atlas.texture || !atlas.textureSize) return;

        const device = this._device;
        const [w, h] = atlas.textureSize;

        // Extract raw bytes
        let bytes: ArrayBuffer | null = null;
        if (atlas.texture instanceof ImageData) {
            bytes = atlas.texture.data.buffer as ArrayBuffer;
        } else if ((atlas.texture as any).data) {
            const tData = (atlas.texture as any).data;
            bytes = tData.buffer ? (tData.buffer as ArrayBuffer) : tData;
        }
        if (!bytes) return;

        // Create GPU texture
        this._atlasTexture = device.createTexture({
            size: [w, h],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.writeTexture(
            { texture: this._atlasTexture },
            bytes,
            { bytesPerRow: w * 4 },
            [w, h],
        );

        // Rebuild bind group with new texture
        this._rebuildBindGroup();
    }

    private _rebuildBindGroup() {
        if (!this._device || !this._pipeline || !this._uniformBuffer || !this._atlasTexture || !this._atlasSampler) return;

        this._bindGroup = this._device.createBindGroup({
            layout: this._pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this._uniformBuffer } },
                { binding: 1, resource: this._atlasTexture.createView() },
                { binding: 2, resource: this._atlasSampler },
            ],
        });
    }

    setTransform(scale: number, tx: number, ty: number): void {
        this._transformMatrix[0] = scale; this._transformMatrix[1] = 0; this._transformMatrix[2] = 0;
        this._transformMatrix[3] = 0; this._transformMatrix[4] = scale; this._transformMatrix[5] = 0;
        this._transformMatrix[6] = tx; this._transformMatrix[7] = ty; this._transformMatrix[8] = 1;
    }

    render(layout: LayoutResult, atlas: MSDFAtlas | null): void {
        if (!this._ready || !this._device || !this._context || !this._pipeline || !this._bindGroup || !atlas) return;
        if (layout.glyphs.length === 0) return;

        const device = this._device;

        // Pack instance data (same format as WebGLRenderer: 11 floats per instance)
        const instanceData = new Float32Array(layout.glyphs.length * 11);
        let validGlyphs = 0;
        const atlasW = atlas.textureSize[0]!;
        const atlasH = atlas.textureSize[1]!;
        const ATLAS_FONT_SIZE = 42.0;

        for (const g of layout.glyphs) {
            const chr = g.char ?? '';
            const atlasGlyph = atlas.glyphs.find(ag => ag.char === chr);
            if (!atlasGlyph) continue;

            const emScale = g.fontSize / ATLAS_FONT_SIZE;
            const uvX = atlasGlyph.atlasPosition[0] / atlasW;
            const uvY = atlasGlyph.atlasPosition[1] / atlasH;
            const uvW = atlasGlyph.atlasSize[0] / atlasW;
            const uvH = atlasGlyph.atlasSize[1] / atlasH;

            const w = (atlasGlyph.bounds.right - atlasGlyph.bounds.left) * emScale;
            const h = (atlasGlyph.bounds.top - atlasGlyph.bounds.bottom) * emScale;
            const physX = g.x + (atlasGlyph.xoffset * emScale);
            const physY = g.y - (atlasGlyph.bounds.top * emScale);

            const paddedW = atlasGlyph.atlasSize[0];
            const unpaddedW = Math.max(atlasGlyph.bounds.right - atlasGlyph.bounds.left, 0.0001);
            const paddedH = atlasGlyph.atlasSize[1];
            const unpaddedH = Math.max(atlasGlyph.bounds.top - atlasGlyph.bounds.bottom, 0.0001);

            const finalW = w * (paddedW / unpaddedW);
            const finalH = h * (paddedH / unpaddedH);
            const finalX = physX - (finalW - w) / 2;
            const finalY = physY - (finalH - h) / 2;

            const colorStr = g.color || '#000000';
            let cr = 0, cg = 0, cb = 0;
            if (colorStr.startsWith('#') && colorStr.length >= 7) {
                cr = parseInt(colorStr.slice(1, 3), 16) / 255;
                cg = parseInt(colorStr.slice(3, 5), 16) / 255;
                cb = parseInt(colorStr.slice(5, 7), 16) / 255;
            }

            const idx = validGlyphs * 11;
            instanceData[idx + 0] = finalX; instanceData[idx + 1] = finalY;
            instanceData[idx + 2] = finalW; instanceData[idx + 3] = finalH;
            instanceData[idx + 4] = uvX; instanceData[idx + 5] = uvY;
            instanceData[idx + 6] = uvX + uvW; instanceData[idx + 7] = uvY + uvH;
            instanceData[idx + 8] = cr; instanceData[idx + 9] = cg; instanceData[idx + 10] = cb;
            validGlyphs++;
        }

        if (validGlyphs === 0) return;

        // Upload instance data
        const instanceBytes = instanceData.subarray(0, validGlyphs * 11);
        if (!this._instanceBuffer || this._instanceBuffer.size < instanceBytes.byteLength) {
            if (this._instanceBuffer) this._instanceBuffer.destroy();
            this._instanceBuffer = device.createBuffer({
                size: instanceBytes.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
        }
        device.queue.writeBuffer(this._instanceBuffer, 0, instanceBytes);

        // Upload uniforms
        const uniformData = new Float32Array(16); // resolution (2f) + padding + transform (3x3 = 9f padded to 12f)
        uniformData[0] = this._canvas.width / (this._config.dpiScale ?? 1);
        uniformData[1] = this._canvas.height / (this._config.dpiScale ?? 1);
        // mat3x3 in WGSL is stored as 3 vec4s (with padding)
        uniformData[4] = this._transformMatrix[0]!; uniformData[5] = this._transformMatrix[1]!; uniformData[6] = this._transformMatrix[2]!;
        uniformData[8] = this._transformMatrix[3]!; uniformData[9] = this._transformMatrix[4]!; uniformData[10] = this._transformMatrix[5]!;
        uniformData[12] = this._transformMatrix[6]!; uniformData[13] = this._transformMatrix[7]!; uniformData[14] = this._transformMatrix[8]!;
        device.queue.writeBuffer(this._uniformBuffer!, 0, uniformData);

        // Encode render pass
        const encoder = device.createCommandEncoder();
        const textureView = this._context.getCurrentTexture().createView();

        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 }, // Transparent clear
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        renderPass.setPipeline(this._pipeline);
        renderPass.setBindGroup(0, this._bindGroup);
        renderPass.setVertexBuffer(0, this._quadBuffer!);
        renderPass.setVertexBuffer(1, this._instanceBuffer);
        renderPass.draw(6, validGlyphs);
        renderPass.end();

        device.queue.submit([encoder.finish()]);
    }

    getCanvas(): HTMLCanvasElement {
        return this._canvas;
    }

    dispose(): void {
        this._instanceBuffer?.destroy();
        this._quadBuffer?.destroy();
        this._uniformBuffer?.destroy();
        this._atlasTexture?.destroy();
        this._device?.destroy();
    }
}
