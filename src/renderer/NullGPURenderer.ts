/* ═══════════════════════════════════════════════════════════════
   NullGPURenderer — Canvas 2D fallback when WebGL 2 / WebGPU is unavailable.

   All methods are no-ops. Text is rendered by CanvasRenderer with
   drawText: true (Canvas 2D font rasterisation).
   ═══════════════════════════════════════════════════════════════ */

import type { IGPURenderer } from './GPURendererInterface';
import type { LayoutResult } from '../types';
import type { MSDFAtlas } from '@zappar/msdf-generator';

export class NullGPURenderer implements IGPURenderer {
    private _canvas: HTMLCanvasElement;

    constructor() {
        // 1×1 transparent canvas — composited by CanvasRenderer as a blank overlay
        this._canvas = document.createElement('canvas');
        this._canvas.width = 1;
        this._canvas.height = 1;
    }

    setAtlas(_atlas: MSDFAtlas): void { /* no-op */ }
    setTransform(_scale: number, _tx: number, _ty: number): void { /* no-op */ }
    render(_layout: LayoutResult, _atlas: MSDFAtlas | null): void { /* no-op */ }
    getCanvas(): HTMLCanvasElement { return this._canvas; }
    dispose(): void { /* no-op */ }
}
