/* ═══════════════════════════════════════════════════════════════
   IGPURenderer — GPU Renderer Abstraction Interface

   Defines the contract for GPU-accelerated text renderers.
   Implementations: WebGLRenderer (current), WebGPURenderer (future).
   ═══════════════════════════════════════════════════════════════ */

import type { LayoutResult } from '../types';
import type { MSDFAtlas } from '@zappar/msdf-generator';

export interface GPURenderConfig {
    paperWidth: number;
    paperHeight: number;
    paperColor?: string;
    dpiScale?: number;
}

/**
 * Abstract interface for GPU-accelerated text renderers.
 *
 * Both `WebGLRenderer` and `WebGPURenderer` implement this interface,
 * allowing the application to swap backends without changing rendering logic.
 */
export interface IGPURenderer {
    /**
     * Upload an MSDF atlas texture to the GPU.
     * Must be called once when the atlas is generated and whenever it changes.
     */
    setAtlas(atlas: MSDFAtlas): void;

    /**
     * Set the camera transformation for zoom/pan.
     * @param scale  Uniform scale factor (1.0 = 100%)
     * @param tx     Horizontal translation in logical pixels
     * @param ty     Vertical translation in logical pixels
     */
    setTransform(scale: number, tx: number, ty: number): void;

    /**
     * Render a full layout frame with the current atlas and transform.
     * @param layout  The composed layout result with positioned glyphs
     * @param atlas   The MSDF atlas (also available via setAtlas, but passed for convenience)
     */
    render(layout: LayoutResult, atlas: MSDFAtlas | null): void;

    /**
     * Get the underlying canvas element.
     * Used by CanvasRenderer to composite the GPU output onto the 2D canvas.
     */
    getCanvas(): HTMLCanvasElement;

    /**
     * Release all GPU resources (textures, buffers, shaders).
     * Call when the renderer is no longer needed.
     */
    dispose(): void;
}
