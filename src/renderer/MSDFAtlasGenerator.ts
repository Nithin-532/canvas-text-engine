/* ═══════════════════════════════════════════════════════════════
   MSDFAtlasGenerator — Asynchronous MSDF Texture Generation
   
   Wraps the @zappar/msdf-generator WASM module to generate 
   Multi-channel Signed Distance Field atlases for our font.
   Runs in a background Web Worker so it won't freeze the main
   thread while generating.
   ═══════════════════════════════════════════════════════════════ */

import { MSDF, type MSDFAtlas } from '@zappar/msdf-generator';

import workerUrl from '@zappar/msdf-generator/worker?worker&url';
import wasmUrl from '@zappar/msdf-generator/msdfgen_wasm.wasm?url';

export class MSDFAtlasGenerator {
    private _msdf: MSDF | null = null;
    private _isInitializing: Promise<void> | null = null;

    /**
     * Initializes the MSDF generator Web Worker and WASM module.
     * Safe to call multiple times (returns the original promise).
     */
    async init(): Promise<void> {
        if (this._msdf) return;
        if (this._isInitializing) return this._isInitializing;

        this._isInitializing = (async () => {
            this._msdf = new MSDF({
                workerUrl,
                wasmUrl
            });
            await this._msdf.initialize();
        })();

        return this._isInitializing;
    }

    /**
     * Generates a new MSDF texture atlas for the given font and character set.
     * 
     * @param fontData The raw TTF/OTF font file bytes
     * @param charset A string containing all unique characters to include in the atlas
     * @param fieldRange The width of the SDF edge gradient (typically 4 or 8)
     * @param textureSize The resulting atlas texture size [width, height]
     * @returns The generated MSDF atlas containing ImageData and glyph metrics
     */
    async generateAtlas(
        fontData: ArrayBuffer,
        charset: string,
        fieldRange: number = 4,
        textureSize: [number, number] = [1024, 1024]
    ): Promise<MSDFAtlas> {
        await this.init();

        if (!this._msdf) {
            throw new Error("MSDF generator failed to initialize.");
        }

        // The generator expects a Uint8Array
        const fontArray = new Uint8Array(fontData);

        return await this._msdf.generateAtlas({
            font: fontArray,
            charset,
            type: 'msdf',         // REQUIRED: Tell generator to build Multi-channel SDF
            distanceRange: fieldRange,
            textureSize,
            fontSize: 42, // Default size for the SDF generation (balancing detail vs atlas size)
        });
    }

    /**
     * Terminates the background worker and frees resources.
     */
    async destroy(): Promise<void> {
        if (this._msdf) {
            await this._msdf.dispose();
            this._msdf = null;
            this._isInitializing = null;
        }
    }
}
