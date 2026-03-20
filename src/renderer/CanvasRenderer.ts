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

import type { LayoutResult, PositionedGlyph, ColumnLayout, WrapObject } from '../types';
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
    /** Show wrap polygon outlines (debug) */
    showWrapObjects: boolean;
    /** Whether to draw text glyphs (set false if using WebGL backbuffer) */
    drawText: boolean;
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
    showWrapObjects: true,
    drawText: true,
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
        // The display dimensions and backing buffer are dynamically updated by React
        // and the `render()` method respectively. We shouldn't force-reset them here.
    }

    /**
     * Set up canvas dimensions for retina display.
     */
    private _setupCanvas(): void {
        const { paperWidth, paperHeight, dpiScale } = this._config;
        this._canvas.width = paperWidth * dpiScale;
        this._canvas.height = paperHeight * dpiScale;
        this._ctx.setTransform(dpiScale, 0, 0, dpiScale, 0, 0);
    }

    /**
     * Render the complete layout result.
     */
    render(result: LayoutResult, frames: TextFrame[], selection: [number, number] | null = null, wrapObjects: WrapObject[] = [], webglCanvas?: HTMLCanvasElement, zoom: number = 1, activeStory?: import('../core/Story').Story): void {
        const ctx = this._ctx;
        const { paperWidth, paperHeight, paperColor } = this._config;

        const dpr = window.devicePixelRatio || 1;
        // Resize backing store for zoom+DPR so we get crisp pixels on retina displays
        const targetW = Math.round(paperWidth * zoom * dpr);
        const targetH = Math.round(paperHeight * zoom * dpr);
        if (this._canvas.width !== targetW || this._canvas.height !== targetH) {
            this._canvas.width = targetW;
            this._canvas.height = targetH;
        }

        // Apply zoom+DPR transform — all drawing uses layout coordinates,
        // but renders into the zoomed+DPR pixel buffer for crisp output
        ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);

        // Clear canvas with paper background
        if (this._config.drawText || webglCanvas) {
            ctx.fillStyle = paperColor;
            ctx.fillRect(0, 0, paperWidth, paperHeight);
        } else {
            ctx.clearRect(0, 0, paperWidth, paperHeight);
        }

        if (webglCanvas) {
            ctx.drawImage(webglCanvas, 0, 0, paperWidth, paperHeight);
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

        // Draw wrap object outlines (dashed) in debug mode
        if (this._config.showWrapObjects && wrapObjects.length > 0) {
            this._drawWrapObjects(wrapObjects);
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

        // Draw selection inside clip so it doesn't bleed outside frame bounds
        if (selection) {
            const storyToUse = activeStory ?? (result.glyphs.length > 0 ? result.glyphs[0]!.story : undefined);
            if (storyToUse) {
                this._drawSelection(result, selection, storyToUse);
            }
        }

        // Draw inline object backgrounds FIRST (before glyphs so text appears on top)
        for (const g of result.glyphs) {
            if (g.isInlineObject && g.inlineObject?.type === 'table') {
                const table = g.inlineObject as import('../core/Table').Table;
                const metrics = table.getMetrics();
                // Render table backgrounds and fills only
                table.renderBackground(ctx, g.x, g.y - metrics.ascent);
            }
        }

        // Draw glyphs (including table cell text which is flattened into result.glyphs)
        this._renderGlyphs(result.glyphs);

        // Draw inline object strokes/borders AFTER glyphs (on top of text)
        for (const g of result.glyphs) {
            if (g.isInlineObject && g.inlineObject?.type === 'table') {
                const table = g.inlineObject as import('../core/Table').Table;
                const metrics = table.getMetrics();
                // Render table strokes and decorations
                table.renderStrokes(ctx, g.x, g.y - metrics.ascent);
            }
        }

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
     * Draw wrap object polygons as dashed outlines for debug visualization.
     */
    private _drawWrapObjects(wrapObjects: WrapObject[]): void {
        const ctx = this._ctx;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.7)'; // Orange dashed
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);

        for (const wo of wrapObjects) {
            if (wo.wrapMode === 'none' || wo.polygon.length < 3) continue;
            ctx.beginPath();
            ctx.moveTo(wo.polygon[0]!.x, wo.polygon[0]!.y);
            for (let i = 1; i < wo.polygon.length; i++) {
                ctx.lineTo(wo.polygon[i]!.x, wo.polygon[i]!.y);
            }
            ctx.closePath();
            ctx.stroke();

            // Also fill lightly
            ctx.fillStyle = 'rgba(255, 140, 0, 0.08)';
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Render positioned glyphs using Canvas 2D fillText.
     * Groups glyphs by font to minimize context state changes.
     */
    private _renderGlyphs(glyphs: PositionedGlyph[]): void {
        if (!this._config.drawText) return;
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
            ctx.fillStyle = color ?? '#000';
            ctx.textBaseline = 'alphabetic';
            ctx.font = fontSpec!; // Set once per group — avoid per-glyph ctx.font cost

            for (const glyph of groupGlyphs) {
                const hasScale = Math.abs(glyph.scale - 1.0) > 0.001;

                if (hasScale) {
                    // Hz-program: apply horizontal scale around the glyph's x position
                    ctx.save();
                    ctx.translate(glyph.x, 0);
                    ctx.scale(glyph.scale, 1.0);
                    ctx.font = fontSpec!; // Re-set after save (ctx state was pushed)
                    if (glyph.char) {
                        ctx.fillText(glyph.char, 0, glyph.y);
                    }
                    ctx.restore();
                    ctx.font = fontSpec!; // Restore font after ctx.restore()
                } else {
                    if (glyph.char) {
                        ctx.fillText(glyph.char, glyph.x, glyph.y);
                    } else {
                        ctx.fillText(' ', glyph.x, glyph.y);
                    }
                }

                // Draw underline / strikethrough decorations
                if ((glyph.underline || glyph.strikethrough) && glyph.advance > 0) {
                    const glyphW = glyph.advance;
                    ctx.save();
                    ctx.strokeStyle = color ?? '#000';
                    ctx.lineWidth = Math.max(0.5, glyph.fontSize * 0.06);
                    ctx.beginPath();
                    if (glyph.underline) {
                        const uy = glyph.y + glyph.fontSize * 0.12;
                        ctx.moveTo(glyph.x, uy);
                        ctx.lineTo(glyph.x + glyphW, uy);
                    }
                    if (glyph.strikethrough) {
                        const sy = glyph.y - glyph.fontSize * 0.3;
                        ctx.moveTo(glyph.x, sy);
                        ctx.lineTo(glyph.x + glyphW, sy);
                    }
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    }

    /**
     * Draw an array of IDML graphic lines (rules, dimension marks, etc.).
     * Called from App after rendering the main layout.
     */
    drawGraphicLines(lines: Array<{ x1: number; y1: number; x2: number; y2: number; strokeColor: string; strokeWidth: number }>): void {
        if (!lines.length) return;
        const ctx = this._ctx;
        ctx.save();
        for (const line of lines) {
            if (line.strokeWidth <= 0) continue;
            ctx.strokeStyle = line.strokeColor;
            ctx.lineWidth = line.strokeWidth;
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
        }
        ctx.restore();
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

    private _drawSelection(result: LayoutResult, selection: [number, number], activeStory: import('../core/Story').Story): void {
        const [start, end] = selection;
        const minOffset = Math.min(start, end);
        const maxOffset = Math.max(start, end);
        const ctx = this._ctx;

        if (minOffset === maxOffset) {
            // Draw caret
            let caretGlyph = result.glyphs.find(g => g.charOffset === minOffset && g.story === activeStory);
            let isAfter = false;
            if (!caretGlyph) {
                caretGlyph = result.glyphs.find(g => g.charOffset === minOffset - 1 && g.story === activeStory);
                isAfter = true;
            }
            if (caretGlyph) {
                // Use actual glyph advance for pixel-perfect cursor placement
                const x = isAfter ? caretGlyph.x + caretGlyph.advance : caretGlyph.x;
                ctx.fillStyle = '#2563eb'; // blue-600
                ctx.fillRect(x - 1, caretGlyph.y - caretGlyph.fontSize * 0.8, 2, caretGlyph.fontSize);
            } else {
                // Fallback: if activeStory has no glyphs (e.g. empty table cell),
                // find the cell position and draw caret there
                for (const g of result.glyphs) {
                    if (!g.isInlineObject || !g.inlineObject || g.inlineObject.type !== 'table') continue;
                    const table = g.inlineObject as import('../core/Table').Table;
                    const metrics = table.getMetrics();
                    const tableX = g.x;
                    const tableY = g.y - metrics.ascent;

                    let cellYPos = tableY;
                    for (let r = 0; r < table.rows; r++) {
                        const rowH = table.getRowHeight(r);
                        let cellXPos = tableX;
                        for (let c = 0; c < table.cols; c++) {
                            const colW = table.getColumnWidth(c);
                            // Use getAnchorCell to handle merged cells
                            const cell = table.getAnchorCell(r, c);
                            if (cell && cell.story === activeStory) {
                                const s = cell.style;
                                const caretX = cellXPos + s.paddingLeft;
                                const caretY = cellYPos + s.paddingTop;
                                ctx.fillStyle = '#2563eb';
                                ctx.fillRect(caretX - 1, caretY, 2, 14);
                                return; // Early exit — found the cell
                            }
                            cellXPos += colW;
                        }
                        cellYPos += rowH;
                    }
                }
            }
            return;
        }

        ctx.fillStyle = 'rgba(37, 99, 235, 0.2)'; // Selection color

        const glyphsInRange = result.glyphs.filter(g => g.story === activeStory && g.charOffset >= minOffset && g.charOffset < maxOffset);

        // Group by rounded Y so sub-pixel differences don't split one visual line into two rects
        const linesMap = new Map<number, typeof result.glyphs>();
        for (const g of glyphsInRange) {
            const ky = Math.round(g.y * 2) / 2; // 0.5pt buckets
            let arr = linesMap.get(ky);
            if (!arr) { arr = []; linesMap.set(ky, arr); }
            arr.push(g);
        }

        // Collect contiguous glyph groups (split on column gaps > 20pt)
        const rectGroups: Array<typeof result.glyphs> = [];
        for (const lineGlyphs of linesMap.values()) {
            lineGlyphs.sort((a, b) => a.x - b.x);
            let groupStart = 0;
            for (let i = 1; i < lineGlyphs.length; i++) {
                const prev = lineGlyphs[i - 1]!;
                const curr = lineGlyphs[i]!;
                // Gap larger than ~1 character = different column; start new rect group
                if (curr.x - (prev.x + prev.advance) > 20) {
                    rectGroups.push(lineGlyphs.slice(groupStart, i));
                    groupStart = i;
                }
            }
            rectGroups.push(lineGlyphs.slice(groupStart));
        }

        for (const group of rectGroups) {
            if (group.length === 0) continue;
            const first = group[0]!;
            const last = group[group.length - 1]!;

            const lineH = first.fontSize * 1.2;
            const width = (last.x - first.x) + last.advance;
            const h = Math.max(lineH, first.fontSize * 1.1);
            const y = first.y - first.fontSize * 0.85;

            ctx.fillRect(first.x, y, width, h);
        }
    }

    /**
     * Clean up canvas resources.
     */
    dispose(): void {
        // Canvas 2D has no explicit cleanup, but clear references
        this._fontCache.clear();
    }

    /**
     * Draw the in-progress polygon being created by the user.
     * Call this AFTER render() to overlay on top of everything.
     *
     * @param points     Already-placed vertices (canvas coords)
     * @param cursorPt   Current mouse position for preview line (canvas coords, or null)
     * @param snapRadius Radius in px at which cursor "snaps" to close the polygon
     */
    drawPolygonInProgress(
        points: { x: number; y: number }[],
        cursorPt: { x: number; y: number } | null,
        snapRadius = 10,
    ): void {
        if (points.length === 0) return;
        const ctx = this._ctx;
        ctx.save();

        const FILL_OPACITY = 0.12;
        const STROKE_COLOR = 'rgba(99, 202, 183, 0.95)';   // teal
        const VERTEX_COLOR = '#63cab7';
        const PREVIEW_COLOR = 'rgba(99, 202, 183, 0.5)';
        const SNAP_COLOR = '#facc15'; // yellow snap indicator

        // Check if cursor is near start (polygon can close)
        const canClose = cursorPt && points.length >= 3 &&
            Math.hypot(cursorPt.x - points[0]!.x, cursorPt.y - points[0]!.y) <= snapRadius;

        // Fill area (only when 3+ points placed)
        if (points.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(points[0]!.x, points[0]!.y);
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
            if (canClose && cursorPt) ctx.closePath();
            ctx.fillStyle = `rgba(99, 202, 183, ${FILL_OPACITY})`;
            ctx.fill();
        }

        // Draw edges between placed vertices
        ctx.strokeStyle = STROKE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
        ctx.stroke();

        // Preview edge from last vertex to cursor
        if (cursorPt) {
            ctx.strokeStyle = PREVIEW_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
            ctx.lineTo(cursorPt.x, cursorPt.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw vertices
        for (let i = 0; i < points.length; i++) {
            const pt = points[i]!;
            const isFirst = i === 0;
            const snap = isFirst && canClose;

            ctx.beginPath();
            ctx.arc(pt.x, pt.y, snap ? 7 : (isFirst ? 5 : 4), 0, Math.PI * 2);
            ctx.fillStyle = snap ? SNAP_COLOR : VERTEX_COLOR;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Snap label
        if (canClose) {
            ctx.fillStyle = SNAP_COLOR;
            ctx.font = '11px sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.fillText('close', points[0]!.x + 10, points[0]!.y - 4);
        }

        ctx.restore();
    }
}
