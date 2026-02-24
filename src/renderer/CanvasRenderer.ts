/* ═══════════════════════════════════════════════════════════════
   CanvasRenderer — Canvas 2D Text Rendering
   
   Renders the LayoutResult (positioned glyphs) onto an HTML5 
   Canvas using the 2D context. This is the Milestone 1 renderer.
   
   Milestone 2 will replace this with WebGL MSDF rendering.
   For MVP, Canvas 2D gives us:
   - Crisp text via browser's native rasterizer
   - Hit-testing for cursor placement
   - Simple debugging (draw column outlines, baselines)
   ═══════════════════════════════════════════════════════════════ */

import type { LayoutResult, PositionedGlyph, ColumnLayout } from '../types';
import type { TextFrame } from '../core/TextFrame';

export interface RenderConfig {
    /** Paper background color */
    paperColor: string;
    /** Paper dimensions */
    paperWidth: number;
    paperHeight: number;
    /** Show column outlines */
    showColumns: boolean;
    /** Show baselines */
    showBaselines: boolean;
    /** Show glyph bounding boxes (debug) */
    showGlyphBoxes: boolean;
    /** Canvas DPI scale (for retina) */
    dpiScale: number;
}

const DEFAULT_RENDER_CONFIG: RenderConfig = {
    paperColor: '#ffffff',
    paperWidth: 595,
    paperHeight: 842,
    showColumns: true,
    showBaselines: false,
    showGlyphBoxes: false,
    dpiScale: window.devicePixelRatio ?? 1,
};

export class CanvasRenderer {
    private _canvas: HTMLCanvasElement;
    private _ctx: CanvasRenderingContext2D;
    private _config: RenderConfig;
    private _fontCache: Map<string, boolean> = new Map();

    constructor(canvas: HTMLCanvasElement, config?: Partial<RenderConfig>) {
        this._canvas = canvas;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Failed to get Canvas 2D context');
        this._ctx = ctx;
        this._config = { ...DEFAULT_RENDER_CONFIG, ...config };

        this._setupCanvas();
    }

    get config(): RenderConfig {
        return this._config;
    }

    updateConfig(partial: Partial<RenderConfig>): void {
        this._config = { ...this._config, ...partial };
        this._setupCanvas();
    }

    /**
     * Set up canvas dimensions for retina display.
     */
    private _setupCanvas(): void {
        const { paperWidth, paperHeight, dpiScale } = this._config;
        this._canvas.width = paperWidth * dpiScale;
        this._canvas.height = paperHeight * dpiScale;
        this._canvas.style.width = `${paperWidth}px`;
        this._canvas.style.height = `${paperHeight}px`;
        this._ctx.setTransform(dpiScale, 0, 0, dpiScale, 0, 0);
    }

    /**
     * Render the complete layout result.
     */
    render(result: LayoutResult, frames: TextFrame[], selection: [number, number] | null = null): void {
        const ctx = this._ctx;
        const { paperWidth, paperHeight, paperColor } = this._config;

        // Clear canvas with paper background
        ctx.fillStyle = paperColor;
        ctx.fillRect(0, 0, paperWidth, paperHeight);

        // Draw selection first so it's behind text
        if (selection) {
            this._drawSelection(result, selection);
        }

        // Draw frame outlines
        for (const frame of frames) {
            this._drawFrame(frame);
        }

        // Draw column outlines
        if (this._config.showColumns) {
            for (const frameLayout of result.frames) {
                for (const column of frameLayout.columns) {
                    this._drawColumnOutline(column);
                }
            }
        }

        // Draw baselines
        if (this._config.showBaselines) {
            for (const frameLayout of result.frames) {
                for (const column of frameLayout.columns) {
                    for (const line of column.lines) {
                        this._drawBaseline(line.baselineY, column.x, column.x + column.width);
                    }
                }
            }
        }

        // Clip to frame boundaries for text rendering to prevent overflow
        ctx.save();
        ctx.beginPath();
        for (const frame of frames) {
            ctx.rect(frame.x, frame.y, frame.width, frame.height);
        }
        ctx.clip();

        // Draw glyphs
        this._renderGlyphs(result.glyphs);

        ctx.restore(); // Restore clipping

        // Draw overset indicator
        for (const frameLayout of result.frames) {
            if (frameLayout.isOverset) {
                const frame = frames.find((f) => f.id === frameLayout.frameId);
                if (frame) {
                    this._drawOversetIndicator(frame);
                }
            }
        }
    }

    /**
     * Render positioned glyphs using Canvas 2D fillText.
     * Groups glyphs by font to minimize context state changes.
     */
    private _renderGlyphs(glyphs: PositionedGlyph[]): void {
        const ctx = this._ctx;

        // Group by font key for efficient rendering
        const groups = new Map<string, PositionedGlyph[]>();
        for (const glyph of glyphs) {
            // Convert weight number to standard string if needed
            const weight = glyph.fontWeight === 700 ? 'bold' : 'normal';
            const style = glyph.fontStyle === 'italic' ? 'italic' : 'normal';

            const key = `${style} ${weight} ${glyph.fontSize}px ${glyph.fontFamily}|${glyph.color}`;
            const group = groups.get(key) ?? [];
            group.push(glyph);
            groups.set(key, group);
        }

        for (const [key, groupGlyphs] of groups) {
            const [fontSpec, color] = key.split('|');
            ctx.font = fontSpec!;
            ctx.fillStyle = color ?? '#000';
            ctx.textBaseline = 'alphabetic';

            for (const glyph of groupGlyphs) {
                // For Canvas 2D, we render exactly the character the glyph came from,
                // using the precise Knuth-Plass/HarfBuzz X/Y positioning.
                // This breaks the browser's native text shaping because we're rendering
                // character by character, which is EXACTLY what we want (true WYSWIYG layout).
                if (glyph.char) {
                    ctx.fillText(glyph.char, glyph.x, glyph.y);
                } else {
                    // Fallback for control chars
                    ctx.fillText(' ', glyph.x, glyph.y);
                }
            }
        }
    }

    /**
     * (Legacy renderWithText and _renderLine removed. Use render() instead)
     */

    /**
     * Draw a TextFrame outline.
     */
    private _drawFrame(frame: TextFrame): void {
        const ctx = this._ctx;
        ctx.strokeStyle = 'rgba(100, 100, 180, 0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
    }

    /**
     * Draw a column outline.
     */
    private _drawColumnOutline(column: ColumnLayout): void {
        const ctx = this._ctx;
        ctx.strokeStyle = 'rgba(108, 92, 231, 0.2)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(column.x, column.y, column.width, column.height);
        ctx.setLineDash([]);
    }

    /**
     * Draw a baseline indicator.
     */
    private _drawBaseline(y: number, x1: number, x2: number): void {
        const ctx = this._ctx;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
    }

    /**
     * Draw an overset text indicator (red + sign).
     */
    private _drawOversetIndicator(frame: TextFrame): void {
        const ctx = this._ctx;
        const x = frame.x + frame.width - 2;
        const y = frame.y + frame.height - 2;
        const size = 12;

        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x - size, y - size, size, size);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Roboto, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('+', x - size / 2, y - size / 2);
        ctx.textAlign = 'start';
    }

    private _drawSelection(result: LayoutResult, selection: [number, number]): void {
        const [start, end] = selection;
        const minOffset = Math.min(start, end);
        const maxOffset = Math.max(start, end);
        const ctx = this._ctx;

        if (minOffset === maxOffset) {
            // Draw caret
            let caretGlyph = result.glyphs.find(g => g.charOffset === minOffset);
            let isAfter = false;
            if (!caretGlyph) {
                caretGlyph = result.glyphs.find(g => g.charOffset === minOffset - 1);
                isAfter = true;
            }
            if (caretGlyph) {
                const x = isAfter ? caretGlyph.x + caretGlyph.fontSize * 0.5 : caretGlyph.x;
                ctx.fillStyle = '#2563eb'; // blue-600
                ctx.fillRect(x - 1, caretGlyph.y - caretGlyph.fontSize * 0.8, 2, caretGlyph.fontSize);
            }
            return;
        }

        ctx.fillStyle = 'rgba(37, 99, 235, 0.2)'; // Selection color

        for (const frame of result.frames) {
            for (const column of frame.columns) {
                for (const line of column.lines) {
                    // Check if this line intersects the selection range
                    if (minOffset <= line.endOffset && maxOffset >= line.startOffset) {

                        // Get all glyphs on this line that fall WITHIN the selection range
                        const selectedGlyphsOnLine = result.glyphs.filter(g =>
                            g.y === line.baselineY &&
                            g.charOffset >= minOffset &&
                            g.charOffset < maxOffset
                        ).sort((a, b) => a.x - b.x);

                        let startX = line.startX;
                        let endX = line.startX; // Build width dynamically based on glyphs

                        if (selectedGlyphsOnLine.length > 0) {
                            // If it spans entire line, the endX defaults to the last printable glyph, not the whole invisible column block
                            const lastLineGlyph = [...result.glyphs].reverse().find(g => g.y === line.baselineY) ?? selectedGlyphsOnLine[selectedGlyphsOnLine.length - 1]!;
                            endX = lastLineGlyph.x + lastLineGlyph.fontSize * 0.6 + 8;
                            // clamp to column width
                            endX = Math.min(endX, line.startX + line.width);
                            // The selection starts on this line
                            if (minOffset >= line.startOffset) {
                                startX = selectedGlyphsOnLine[0]!.x;
                            }

                            // The selection ends on this line
                            if (maxOffset <= line.endOffset) {
                                const lastGlyph = selectedGlyphsOnLine[selectedGlyphsOnLine.length - 1]!;
                                endX = lastGlyph.x + lastGlyph.fontSize * 0.6; // approx advance
                            } else {
                                // Selection continues to next line, add a little tail
                                const lastGlyph = selectedGlyphsOnLine[selectedGlyphsOnLine.length - 1]!;
                                endX = Math.min(line.startX + line.width, lastGlyph.x + lastGlyph.fontSize * 0.6 + 8);
                            }

                            if (endX > startX) {
                                const h = line.lineHeight;
                                const y = line.baselineY - h * 0.8;
                                ctx.fillRect(startX, y, endX - startX, h);
                            }
                        } else if (minOffset < line.startOffset && maxOffset > line.endOffset) {
                            // Line is completely encompassed by the selection but has no printable glyphs (e.g., empty line or spaces)
                            const h = line.lineHeight;
                            const y = line.baselineY - h * 0.8;

                            // To avoid highlighting massive empty expanses on rows with very few characters
                            // We find the last glyph printed on this line, if any, to constrain the highlight box
                            let fillWidth = line.width;
                            const lineGlyphs = result.glyphs.filter(g => g.y === line.baselineY);
                            if (lineGlyphs.length > 0) {
                                const lastGlyph = lineGlyphs[lineGlyphs.length - 1]!;
                                fillWidth = Math.min(fillWidth, (lastGlyph.x - line.startX) + (lastGlyph.fontSize * 0.6) + 8);
                            }

                            ctx.fillRect(line.startX, y, fillWidth, h);
                        }
                    }
                }
            }
        }
    }

    /**
     * Clean up canvas resources.
     */
    dispose(): void {
        // Canvas 2D has no explicit cleanup, but clear references
        this._fontCache.clear();
    }
}
