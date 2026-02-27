/* ═══════════════════════════════════════════════════════════════
   WebGLRenderer — WebGL 2 Hardware Accelerated Text Rendering
   
   Replaces CanvasRenderer for text drawing. Uses instanced rendering
   to draw thousands of MSDF quads in a single draw call.
   ═══════════════════════════════════════════════════════════════ */

import type { LayoutResult } from '../types';
import type { MSDFAtlas } from '@zappar/msdf-generator';
import type { IGPURenderer } from './GPURendererInterface';
import vertRaw from './shaders/msdf.vert?raw';
import fragRaw from './shaders/msdf.frag?raw';

export interface WebGLRenderConfig {
    paperColor: string;
    paperWidth: number;
    paperHeight: number;
    dpiScale: number;
    textColor: [number, number, number]; // RGB 0-1
}

const DEFAULT_CONFIG: WebGLRenderConfig = {
    paperColor: '#ffffff',
    paperWidth: 595,
    paperHeight: 842,
    dpiScale: window.devicePixelRatio ?? 1,
    textColor: [0.1, 0.1, 0.1],
};

export class WebGLRenderer implements IGPURenderer {
    private _canvas: HTMLCanvasElement;
    private _gl: WebGL2RenderingContext;
    private _config: WebGLRenderConfig;

    private _program: WebGLProgram | null = null;
    private _vao: WebGLVertexArrayObject | null = null;
    private _instanceBuffer: WebGLBuffer | null = null;
    private _atlasTexture: WebGLTexture | null = null;

    // Uniform locations
    private _uResLoc: WebGLUniformLocation | null = null;
    private _uTransformLoc: WebGLUniformLocation | null = null;
    private _uAtlasLoc: WebGLUniformLocation | null = null;


    private _capacity: number = 0;
    private _transformMatrix: Float32Array = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); // 3x3 identity

    constructor(canvas: HTMLCanvasElement, config: Partial<WebGLRenderConfig> = {}) {
        this._canvas = canvas;
        this._config = { ...DEFAULT_CONFIG, ...config };

        // Enable alpha so the WebGL canvas composites properly over the 2D canvas.
        // Text glyphs use premultiplied alpha blending; the background is transparent.
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: false, // MSDF provides the antialiasing
            premultipliedAlpha: true, // Required for correct drawImage compositing
            preserveDrawingBuffer: true // Prevent canvas from clearing between frames
        });

        if (!gl) throw new Error("WebGL 2 not supported");
        this._gl = gl;
        this._config = {
            paperColor: config.paperColor ?? '#ffffff',
            paperWidth: config.paperWidth ?? 800,
            paperHeight: config.paperHeight ?? 600,
            dpiScale: config.dpiScale ?? (window.devicePixelRatio || 1),
            textColor: config.textColor ?? [0.0, 0.0, 0.0]
        };
        this._transformMatrix = new Float32Array([
            1, 0, 0,
            0, 1, 0,
            0, 0, 1
        ]);

        this._initShaders();
        this._initBuffers();
    }

    /** Expose the offscreen canvas so the 2D renderer can composite it */
    getCanvas(): HTMLCanvasElement {
        return this._canvas;
    }

    private _initShaders() {
        const gl = this._gl;

        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, vertRaw);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error("Vertex Shader Error:", gl.getShaderInfoLog(vs));
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, fragRaw);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error("Fragment Shader Error:", gl.getShaderInfoLog(fs));
        }

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Program Link Error:", gl.getProgramInfoLog(program));
        }

        this._program = program;

        gl.useProgram(program);
        this._uResLoc = gl.getUniformLocation(program, "u_resolution");
        this._uTransformLoc = gl.getUniformLocation(program, "u_transform");
        this._uAtlasLoc = gl.getUniformLocation(program, "u_msdfAtlas");


        gl.uniform1i(this._uAtlasLoc, 0); // Texture unit 0
    }

    private _initBuffers() {
        const gl = this._gl;

        this._vao = gl.createVertexArray();
        gl.bindVertexArray(this._vao);

        // --- Static Quad Buffer ---
        // A simple unit square [0,0] to [1,1]
        const quadData = new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            0, 1,
            1, 0,
            1, 1
        ]);
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);
        // loc 0: a_quadVertex
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // --- Dynamic Instance Buffer ---
        this._instanceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);

        // 11 floats per instance = 44 bytes
        //  - pos (2f)   offset 0
        //  - size (2f)  offset 8
        //  - uvTop (2f) offset 16
        //  - uvBot (2f) offset 24
        //  - color (3f) offset 32
        const stride = 11 * 4;

        // loc 1: a_instancePos
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(1, 1);

        // loc 2: a_instanceSize
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
        gl.vertexAttribDivisor(2, 1);

        // loc 3: a_uvTopLeft
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 16);
        gl.vertexAttribDivisor(3, 1);

        // loc 4: a_uvBottomRight
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 24);
        gl.vertexAttribDivisor(4, 1);

        // loc 5: a_instanceColor (RGB)
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, 32);
        gl.vertexAttribDivisor(5, 1);

        gl.bindVertexArray(null);
    }

    /** Set or update the MSDF atlas texture */
    setAtlas(atlas: MSDFAtlas) {
        const gl = this._gl;
        if (!this._atlasTexture) {
            this._atlasTexture = gl.createTexture();
        }

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);



        // Upload raw MSDF texture bytes directly to avoid canvas premultiply alpha corruption
        try {
            if (atlas.texture && atlas.textureSize) {
                let bytes: Uint8Array | null = null;

                if (atlas.texture instanceof ImageData) {
                    bytes = new Uint8Array(atlas.texture.data.buffer);
                } else if ((atlas.texture as any).data) {
                    const tData = (atlas.texture as any).data;
                    if (tData.buffer) {
                        bytes = new Uint8Array(tData.buffer);
                    } else if (tData instanceof Uint8ClampedArray) {
                        bytes = new Uint8Array(tData);
                    } else if (Array.isArray(tData)) {
                        bytes = new Uint8Array(tData);
                    }
                }

                if (bytes) {
                    // Prevent any premultiplied alpha conversion
                    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
                    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

                    gl.texImage2D(
                        gl.TEXTURE_2D, 0, gl.RGBA,
                        atlas.textureSize[0], atlas.textureSize[1],
                        0, gl.RGBA, gl.UNSIGNED_BYTE,
                        bytes
                    );


                } else {
                    console.error("WebGLRenderer: Could not extract raw byte array from texture object.");
                }
            } else {
                console.error("Unknown texture format from MSDF atlas", atlas.texture);
            }
        } catch (e) {
            console.error("gl.texImage2D failed:", e);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /** Set the camera transformation (pan/zoom) */
    setTransform(scale: number, tx: number, ty: number) {
        this._transformMatrix[0] = scale; this._transformMatrix[1] = 0; this._transformMatrix[2] = 0;
        this._transformMatrix[3] = 0; this._transformMatrix[4] = scale; this._transformMatrix[5] = 0;
        this._transformMatrix[6] = tx; this._transformMatrix[7] = ty; this._transformMatrix[8] = 1;
    }

    /** Render a layout frame */
    render(layout: LayoutResult, atlas: MSDFAtlas | null) {

        const gl = this._gl;

        // Resize Canvas to device pixels, accounting for zoom from transform
        const zoomScale = this._transformMatrix[0] ?? 1; // zoom is stored as scale in [0]
        let displayWidth = Math.round(this._config.paperWidth * this._config.dpiScale * zoomScale);
        let displayHeight = Math.round(this._config.paperHeight * this._config.dpiScale * zoomScale);

        // Cap to GPU maximum to prevent silent failures at high zoom
        const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
        const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        const maxW = Math.min(maxDims[0] ?? 4096, maxTex);
        const maxH = Math.min(maxDims[1] ?? 4096, maxTex);
        displayWidth = Math.min(displayWidth, maxW);
        displayHeight = Math.min(displayHeight, maxH);

        if (this._canvas.width !== displayWidth || this._canvas.height !== displayHeight) {
            this._canvas.width = displayWidth;
            this._canvas.height = displayHeight;
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // Clear to fully transparent — the 2D canvas provides the paper background
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (!atlas || layout.glyphs.length === 0) return;

        // 1. Pack instance data
        // Each instance needs 11 floats (pos 2f, size 2f, uvTop 2f, uvBot 2f, color 3f)
        const instanceData = new Float32Array(layout.glyphs.length * 11);
        let validGlyphs = 0;
        const atlasW = atlas.textureSize[0];
        const atlasH = atlas.textureSize[1];

        // We need to scale the MSDF glyph bounds to the logical pixel size
        // MSDF atlas sizes are based on internal font units normalized.
        // `@zappar/msdf-generator` returns glyph info with `bounds` and `atlasPosition/Size`.



        for (let i = 0; i < layout.glyphs.length; i++) {
            const g = layout.glyphs[i]!;
            const chr = g.char ?? '';

            // Find glyph in atlas metadata
            const atlasGlyph = atlas.glyphs.find(ag => ag.char === chr);
            if (!atlasGlyph) continue;

            // Geometry logic: MSDF glyphs have specific scaled bounds
            // The bounds are usually normalized relative to the em-square.
            // We'll calculate the quad size and position offset based on atlas bounds.

            // The SDF edge adds some padding (fieldRange).
            // We need to expand the rendering quad to account for the padding.
            // UVs
            const uvX = atlasGlyph.atlasPosition[0] / atlasW;
            const uvY = atlasGlyph.atlasPosition[1] / atlasH;
            const uvW = atlasGlyph.atlasSize[0] / atlasW;
            const uvH = atlasGlyph.atlasSize[1] / atlasH;

            // Wait, we need the exact physical dimensions for the quad.
            // For now, let's map the atlas bounds to the target font size physically.
            // We know the font size from `g.style.fontSize`.

            // Layout offsets based on `atlasGlyph.bounds` (distance from baseline)
            // Left, bottom, right, top are typically normalized (0 to 1).
            // MSDF Generator defines bounds relative to em size.

            // The atlas was generated with fontSize: 42. So bounds and offsets are in pixels at size 42.
            const ATLAS_FONT_SIZE = 42.0;
            const emScale = g.fontSize / ATLAS_FONT_SIZE;

            const w = (atlasGlyph.bounds.right - atlasGlyph.bounds.left) * emScale;
            // The bounds top/bottom might have the origin at the baseline
            // top is positive, bottom is negative (or zero).
            const h = (atlasGlyph.bounds.top - atlasGlyph.bounds.bottom) * emScale;

            // X offset from the cursor
            const physX = g.x + (atlasGlyph.xoffset * emScale);
            // Y offset from the baseline (baseline is Y+ down, but bounds are Y+ up)
            const physY = g.y - (atlasGlyph.bounds.top * emScale);

            // Calculate padded bounds (the texture contains the field range)
            // The atlas bounds DO NOT include the SDF padding, but the atlasSize DOES.
            // Wait, atlasSize = width + 2*fieldRange. We must scale the rendering quad identically.

            // Ratio of padded size to unpadded size
            const paddedW = atlasGlyph.atlasSize[0];
            const unpaddedW = Math.max((atlasGlyph.bounds.right - atlasGlyph.bounds.left), 0.0001); // Avoid div 0 if char is empty e.g. space
            const xPaddingRatio = paddedW / unpaddedW;

            const paddedH = atlasGlyph.atlasSize[1];
            const unpaddedH = Math.max((atlasGlyph.bounds.top - atlasGlyph.bounds.bottom), 0.0001);
            const yPaddingRatio = paddedH / unpaddedH;

            // Scale physWidth by padding ratio
            const finalW = w * xPaddingRatio;
            const finalH = h * yPaddingRatio;

            // Offset the X and Y backwards by the padding amount to keep centered
            const xPadPhysical = (finalW - w) / 2;
            const yPadPhysical = (finalH - h) / 2;

            const finalX = physX - xPadPhysical;
            const finalY = physY - yPadPhysical;

            // Parse glyph color (hex string like '#e74c3c' to RGB 0-1)
            const colorStr = g.color || '#000000';
            let cr = 0, cg = 0, cb = 0;
            if (colorStr.startsWith('#') && colorStr.length >= 7) {
                cr = parseInt(colorStr.slice(1, 3), 16) / 255;
                cg = parseInt(colorStr.slice(3, 5), 16) / 255;
                cb = parseInt(colorStr.slice(5, 7), 16) / 255;
            }

            // Pack
            const idx = validGlyphs * 11;
            instanceData[idx + 0] = finalX;
            instanceData[idx + 1] = finalY;
            instanceData[idx + 2] = finalW;
            instanceData[idx + 3] = finalH;

            instanceData[idx + 4] = uvX;
            instanceData[idx + 5] = uvY;
            instanceData[idx + 6] = uvX + uvW;
            instanceData[idx + 7] = uvY + uvH;

            instanceData[idx + 8] = cr;
            instanceData[idx + 9] = cg;
            instanceData[idx + 10] = cb;



            validGlyphs++;
        }



        if (validGlyphs === 0) return;

        // Upload instance data
        gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);

        // Ensure the buffer is large enough
        if (validGlyphs > this._capacity) {
            // Reallocate buffer with some extra padding to avoid frequent reallocations
            const newCapacity = validGlyphs * 2;
            const newBuffer = new Float32Array(newCapacity * 11);
            newBuffer.set(instanceData.subarray(0, validGlyphs * 11));

            gl.bufferData(gl.ARRAY_BUFFER, newBuffer, gl.DYNAMIC_DRAW);
            this._capacity = newCapacity;
        } else {
            // Update existing buffer
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, validGlyphs * 11));
        }

        // Draw instances
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Premultiplied alpha blending

        gl.useProgram(this._program);
        gl.bindVertexArray(this._vao);

        gl.uniform2f(this._uResLoc, this._canvas.width / this._config.dpiScale, this._canvas.height / this._config.dpiScale);
        gl.uniformMatrix3fv(this._uTransformLoc, false, this._transformMatrix);


        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);

        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, validGlyphs);

        gl.bindVertexArray(null);
    }

    /** Release all GPU resources */
    dispose() {
        const gl = this._gl;
        if (this._program) gl.deleteProgram(this._program);
        if (this._vao) gl.deleteVertexArray(this._vao);
        if (this._instanceBuffer) gl.deleteBuffer(this._instanceBuffer);
        if (this._atlasTexture) gl.deleteTexture(this._atlasTexture);
    }
}
