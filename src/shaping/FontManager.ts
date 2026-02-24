/* ═══════════════════════════════════════════════════════════════
   FontManager — HarfBuzz WASM Integration
   
   Loads font files, creates HarfBuzz blob/face/font objects,
   and provides text shaping via the harfbuzzjs WASM module.
   Also exposes opentype.js Font for glyph path access.
   ═══════════════════════════════════════════════════════════════ */

import type { ShapedGlyph, CharacterStyle } from '../types';
import hbWasmUrl from 'harfbuzzjs/hb.wasm?url';
import { loadHarfbuzz, HarfBuzzBlob, HarfBuzzFace, HarfBuzzFont, HarfBuzzBuffer } from './harfbuzz';

/** Font metrics extracted from the font file */
export interface FontMetrics {
    ascent: number;
    descent: number;
    lineGap: number;
    unitsPerEm: number;
    /** Computed line height = (ascent - descent + lineGap) / unitsPerEm */
    lineHeightRatio: number;
}

/** A loaded font with HarfBuzz objects ready for shaping */
export interface LoadedFont {
    family: string;
    blob: HarfBuzzBlob;
    face: HarfBuzzFace;
    font: HarfBuzzFont;
    metrics: FontMetrics;
    fontData: ArrayBuffer;
}

export class FontManager {
    private _isReady: boolean = false;
    private _fonts: Map<string, LoadedFont> = new Map();
    private _initPromise: Promise<void> | null = null;

    /** Initialize the HarfBuzz WASM module */
    async init(): Promise<void> {
        if (this._isReady) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = this._doInit();
        return this._initPromise;
    }

    private async _doInit(): Promise<void> {
        await loadHarfbuzz(hbWasmUrl);
        this._isReady = true;
    }

    get isReady(): boolean {
        return this._isReady;
    }

    /** Load a font from an ArrayBuffer (TTF/OTF) */
    loadFont(family: string, data: ArrayBuffer, weight: string = '400', style: string = 'normal'): LoadedFont {
        const u8 = new Uint8Array(data);
        const blob = new HarfBuzzBlob(u8);
        const face = new HarfBuzzFace(blob, 0);
        const font = new HarfBuzzFont(face);

        // Extract metrics from the font
        // HarfBuzz gives metrics in font units. We parse from the raw data.
        const metrics = this._extractMetrics(data);

        // Set font scale to match font units (default is fine for most use cases)
        font.setScale(metrics.unitsPerEm, metrics.unitsPerEm);

        const loaded: LoadedFont = { family, blob, face, font, metrics, fontData: data };

        // Use a composite key for looking up font variants
        const fontKey = `${family}-${weight}-${style}`;
        this._fonts.set(fontKey, loaded);

        return loaded;
    }

    /** Load a font from a URL */
    async loadFontFromUrl(family: string, url: string, weight: string = '400', style: string = 'normal'): Promise<LoadedFont> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load font from ${url}: ${response.statusText}`);
        const data = await response.arrayBuffer();
        return this.loadFont(family, data, weight, style);
    }

    /** Get a loaded font by family, weight, and style */
    getFont(family: string, weight: number | string = 400, style: string = 'normal'): LoadedFont | undefined {
        const key = `${family}-${weight}-${style}`;

        // Fallbacks
        if (this._fonts.has(key)) return this._fonts.get(key);
        if (this._fonts.has(`${family}-400-${style}`)) return this._fonts.get(`${family}-400-${style}`);
        if (this._fonts.has(`${family}-${weight}-normal`)) return this._fonts.get(`${family}-${weight}-normal`);

        // Ultimate fallback to just family + default 
        return this._fonts.get(`${family}-400-normal`);
    }

    /**
     * Shape a text string using the specified font and return individual glyph positions.
     * This is the core text shaping operation — Unicode codepoints → positioned glyphs.
     */
    shapeText(
        text: string,
        style: CharacterStyle,
        direction: "ltr" | "rtl" | "ttb" | "btt" = 'ltr',
    ): ShapedGlyph[] {
        const loaded = this.getFont(style.fontFamily, style.fontWeight, style.fontStyle);
        if (!loaded) {
            throw new Error(`Font "${style.fontFamily}" (weight: ${style.fontWeight}, style: ${style.fontStyle}) not loaded.`);
        }

        // Create and configure the buffer
        const buffer = new HarfBuzzBuffer();
        buffer.addText(text);
        buffer.setDirection(direction);
        // Note: harfbuzz.ts doesn't expose setScript/setLanguage yet
        // but it does expose guessSegmentProperties
        buffer.guessSegmentProperties();

        // Build OpenType feature string: {"liga": true}
        // harfbuzz.ts doesn't implement advanced features string parsing yet in `shape`,
        // it simply takes a `features` array or ignores it.
        // We will just pass an empty string for now to avoid C string crashes.

        // Shape!
        buffer.shape(loaded.font);

        // Extract results
        const glyphInfos = buffer.json();
        const shapedGlyphs: ShapedGlyph[] = glyphInfos.map((info) => ({
            glyphId: info.GlyphId,
            cluster: info.Cluster,
            xAdvance: info.XAdvance,
            yAdvance: info.YAdvance,
            xOffset: info.XOffset,
            yOffset: info.YOffset,
        }));

        // Clean up the buffer
        buffer.destroy();

        return shapedGlyphs;
    }

    /**
     * Measure the total advance width of a shaped text run.
     * Returns width in font units — divide by unitsPerEm * fontSize for pixels.
     */
    measureText(text: string, style: CharacterStyle): number {
        const glyphs = this.shapeText(text, style);
        return glyphs.reduce((sum, g) => sum + g.xAdvance, 0);
    }

    /**
     * Convert font units to pixels for a given font size.
     */
    fontUnitsToPixels(fontUnits: number, fontSize: number, family: string, weight: number | string = 400, style: string = 'normal'): number {
        const loaded = this.getFont(family, weight, style);
        if (!loaded) return fontUnits;
        return (fontUnits / loaded.metrics.unitsPerEm) * fontSize;
    }

    /**
     * Extract basic font metrics from raw font data.
     * Reads the OS/2 and hhea tables.
     */
    private _extractMetrics(data: ArrayBuffer): FontMetrics {
        const view = new DataView(data);

        // Read the number of tables
        const numTables = view.getUint16(4);

        // Default metrics (fallback)
        let ascent = 800;
        let descent = -200;
        let lineGap = 0;
        let unitsPerEm = 1000;

        // Parse table directory
        for (let i = 0; i < numTables; i++) {
            const offset = 12 + i * 16;
            const tag = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3),
            );
            const tableOffset = view.getUint32(offset + 8);

            if (tag === 'head') {
                // unitsPerEm is at offset 18 within the head table
                unitsPerEm = view.getUint16(tableOffset + 18);
            } else if (tag === 'hhea') {
                // hhea table: ascent (offset 4), descent (offset 6), lineGap (offset 8)
                ascent = view.getInt16(tableOffset + 4);
                descent = view.getInt16(tableOffset + 6);
                lineGap = view.getInt16(tableOffset + 8);
            }
        }

        return {
            ascent,
            descent,
            lineGap,
            unitsPerEm,
            lineHeightRatio: (ascent - descent + lineGap) / unitsPerEm,
        };
    }

    /** Clean up all HarfBuzz resources */
    destroy(): void {
        for (const font of this._fonts.values()) {
            font.font.destroy();
            font.face.destroy();
            font.blob.destroy();
        }
        this._fonts.clear();
        this._isReady = false;
        this._initPromise = null;
    }
}
