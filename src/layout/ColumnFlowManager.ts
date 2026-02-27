/* ═══════════════════════════════════════════════════════════════
   ColumnFlowManager — Text Distribution Engine
   ═══════════════════════════════════════════════════════════════ */

import type {
    KnuthPlassElement,
    LineBreak,
    ComposedLine,
    ColumnLayout,
    FrameLayout,
    PositionedGlyph,
    ParagraphStyle,
    TextAlignment,
    LayoutResult,
} from '../types';
import { FrameManager } from '../core/TextFrame';
import { FontManager } from '../shaping/FontManager';
import { computeLineScale, DEFAULT_HZ_CONFIG } from './GlyphScaler';
import { getLeadingIndent, getTrailingIndent } from './OpticalMargins';
import { ScanlineEngine } from '../geometry/ScanlineEngine';
import type { WrapPolygon } from '../geometry/ScanlineEngine';
import type { WrapObject } from '../types';

function extractLineElements(
    elements: KnuthPlassElement[],
    startElementIdx: number,
    breakIdx: number,
): KnuthPlassElement[] {
    const lineElements: KnuthPlassElement[] = [];
    for (let i = startElementIdx; i <= breakIdx; i++) {
        const el = elements[i]!;
        if (lineElements.length === 0 && el.type === 'glue') continue;
        if (i === breakIdx && el.type === 'penalty') continue;
        if (i === breakIdx && el.type === 'glue') continue;
        lineElements.push(el);
    }
    return lineElements;
}

function naturalWidth(elements: KnuthPlassElement[]): number {
    return elements.reduce((sum, el) => {
        if (el.type === 'box') return sum + el.width;
        if (el.type === 'glue') return sum + el.width;
        return sum;
    }, 0);
}

function alignmentOffset(
    lineWidth: number,
    targetWidth: number,
    alignment: TextAlignment,
    isLastLine: boolean,
): number {
    switch (alignment) {
        case 'left': return 0;
        case 'right': return targetWidth - lineWidth;
        case 'center': return (targetWidth - lineWidth) / 2;
        case 'justify': return isLastLine ? 0 : 0;
        case 'forceJustify': return 0;
        default: return 0;
    }
}

/**
 * Pick the best available slot for a line at a given Y band.
 * Strategy:
 * - If 0 usable slots: return null (occluded)
 * - If 1 usable slot (polygon on edge): return that slot
 * - If >= 2 usable slots (polygon in center): return null (skip text around center polygons)
 */
function pickBestSlot(
    intervals: { x: number; width: number }[],
    columnX: number,
    columnWidth: number,
): { x: number; width: number } | null {
    // Ignore tiny slivers that can't realistically fit text
    const MIN_SLOT_WIDTH = 30;
    const usable = intervals.filter(iv => iv.width >= MIN_SLOT_WIDTH);

    if (usable.length === 0) return null; // Entirely occluded
    if (usable.length === 1) return usable[0]!; // Edge polygon -> use the one free side

    // Center polygon (multiple free sides) -> discard both, force text below
    return null;
}

export class ColumnFlowManager {
    private _fontManager: FontManager;
    private _scanlineEngine: ScanlineEngine;
    private _wrapPolygons: WrapPolygon[] = [];

    constructor(fontManager: FontManager) {
        this._fontManager = fontManager;
        this._scanlineEngine = new ScanlineEngine();
    }

    setWrapObjects(wrapObjects: WrapObject[]): void {
        this._wrapPolygons = wrapObjects
            .filter(w => w.wrapMode === 'around')
            .map(w => ({
                polygon: { points: w.polygon },
                padding: w.padding,
            }));
    }

    /**
     * Distribute composed lines into columns and frames.
     *
     * For each Y band, computes the available horizontal intervals
     * (after subtracting wrap polygons) and places the line in the
     * WIDEST available slot — so text flows around the polygon to
     * whichever side has more space.
     */
    distribute(
        lines: ComposedLine[],
        frameManager: FrameManager,
        startFrameId: string,
    ): LayoutResult {
        const startTime = performance.now();
        const frameLayouts: FrameLayout[] = [];
        const allGlyphs: PositionedGlyph[] = [];

        const thread = frameManager.getThread(startFrameId);
        if (thread.length === 0) {
            return { frames: [], glyphs: [], composeTimeMs: performance.now() - startTime, lineCount: 0, glyphCount: 0 };
        }

        let lineIdx = 0;

        for (const frame of thread) {
            const columnGeometries = frame.getColumnGeometries();
            const columns: ColumnLayout[] = columnGeometries.map((geo, idx) => ({
                index: idx,
                x: geo.x, y: geo.y, width: geo.width, height: geo.height,
                lines: [],
            }));

            for (const column of columns) {
                let currentY = column.y;

                while (lineIdx < lines.length) {
                    const lineHeight = lines[lineIdx]!.lineHeight;

                    if (currentY + lineHeight > column.y + column.height) break;

                    // Compute available intervals at this Y band
                    const intervals = this._scanlineEngine.getRectIntervals(
                        column.x, column.width, this._wrapPolygons, currentY, lineHeight,
                    );

                    // Pick the best slot. If null, the band is occluded (or splitting center polygon).
                    // In that case, we advance Y and check the next band.
                    const slot = pickBestSlot(intervals, column.x, column.width);
                    if (!slot) {
                        currentY += lineHeight;
                        continue;
                    }

                    const line = lines[lineIdx]!;
                    const isLastLine = lineIdx === lines.length - 1 ||
                        lines[lineIdx + 1]?.alignment !== line.alignment;

                    const positionedLine: ComposedLine = {
                        ...line,
                        baselineY: currentY + lineHeight * 0.8,
                        startX: slot.x + alignmentOffset(
                            naturalWidth(line.elements),
                            slot.width,
                            line.alignment,
                            isLastLine,
                        ),
                        width: slot.width,
                    };

                    // Optical margin alignment
                    if ((line as any).opticalMargins && line.elements.length > 0) {
                        for (const el of line.elements) {
                            if (el.type === 'box' && el.glyphs.length > 0) {
                                const firstChar = el.glyphs[0]?.char ?? '';
                                const firstGlyphWidth = this._fontManager.fontUnitsToPixels(
                                    el.glyphs[0]!.glyph.xAdvance, el.style.fontSize, el.style.fontFamily,
                                );
                                const leadIndent = getLeadingIndent(firstChar, firstGlyphWidth);
                                if (leadIndent > 0) {
                                    positionedLine.startX -= leadIndent;
                                    positionedLine.width += leadIndent;
                                }
                                break;
                            }
                        }
                        for (let ei = line.elements.length - 1; ei >= 0; ei--) {
                            const el = line.elements[ei]!;
                            if (el.type === 'box' && el.glyphs.length > 0) {
                                const lastGlyph = el.glyphs[el.glyphs.length - 1]!;
                                const lastChar = lastGlyph.char ?? '';
                                const lastGlyphWidth = this._fontManager.fontUnitsToPixels(
                                    lastGlyph.glyph.xAdvance, el.style.fontSize, el.style.fontFamily,
                                );
                                const trailIndent = getTrailingIndent(lastChar, lastGlyphWidth);
                                if (trailIndent > 0) positionedLine.width += trailIndent;
                                break;
                            }
                        }
                    }

                    const lineGlyphs = this._positionGlyphs(positionedLine, slot.width, line.alignment, isLastLine);
                    allGlyphs.push(...lineGlyphs);
                    column.lines.push(positionedLine);
                    lineIdx++;
                    currentY += lineHeight;
                }
            }

            frameLayouts.push({ frameId: frame.id, columns, isOverset: false });
            if (lineIdx >= lines.length) break;
        }

        if (lineIdx < lines.length) {
            const lastFrame = frameLayouts[frameLayouts.length - 1];
            if (lastFrame) lastFrame.isOverset = true;
        }

        const composeTime = performance.now() - startTime;
        return {
            frames: frameLayouts,
            glyphs: allGlyphs,
            composeTimeMs: composeTime,
            lineCount: lineIdx,
            glyphCount: allGlyphs.length,
        };
    }

    /**
     * Build an array of available line widths for a new paragraph.
     * Simulates placing `previousLines` to find the exact starting Y-position,
     * then simulates placing up to `maxLinesToSimulate` lines of height `approxLineHeight`,
     * accounting for frame breaks, column breaks, and wrap exclusions.
     */
    buildLineWidthsForParagraph(
        previousLines: ComposedLine[],
        frameManager: FrameManager,
        startFrameId: string,
        approxLineHeight: number,
        maxLinesToSimulate: number = 200,
    ): number[] {
        const widths: number[] = [];

        const thread = frameManager.getThread(startFrameId);
        if (thread.length === 0) return widths;

        let lineIdx = 0;
        let pLineIdx = 0;
        let defaultWidth = 0;

        for (const frame of thread) {
            const columnGeometries = frame.getColumnGeometries();

            for (const col of columnGeometries) {
                let currentY = col.y;

                // 1. Consume previous lines in this column
                while (lineIdx < previousLines.length) {
                    const line = previousLines[lineIdx]!;
                    if (currentY + line.lineHeight > col.y + col.height) {
                        break; // Move to next column
                    }

                    if (this._wrapPolygons.length > 0) {
                        const intervals = this._scanlineEngine.getRectIntervals(
                            col.x, col.width, this._wrapPolygons, currentY, line.lineHeight,
                        );
                        const slot = pickBestSlot(intervals, col.x, col.width);
                        if (!slot) {
                            currentY += line.lineHeight;
                            continue; // Band occluded, advance Y but don't consume a line
                        }
                    }

                    currentY += line.lineHeight;
                    lineIdx++;
                }

                // If we haven't consumed all previous lines, move to the next column
                if (lineIdx < previousLines.length) continue;

                // 2. We are correctly at the start of the remaining space for the new paragraph!
                defaultWidth = col.width;
                while (pLineIdx < maxLinesToSimulate) {
                    if (currentY + approxLineHeight > col.y + col.height) {
                        break; // Column full for simulated lines; move to next column
                    }

                    if (this._wrapPolygons.length === 0) {
                        widths.push(col.width);
                        pLineIdx++;
                    } else {
                        const intervals = this._scanlineEngine.getRectIntervals(
                            col.x, col.width, this._wrapPolygons, currentY, approxLineHeight,
                        );
                        const slot = pickBestSlot(intervals, col.x, col.width);
                        if (slot) {
                            widths.push(slot.width);
                            pLineIdx++;
                        }
                        // If null, we simply advance Y. We don't increment pLineIdx
                        // because no line can fit here; the line waits for the next Y.
                    }

                    currentY += approxLineHeight;
                }

                if (pLineIdx >= maxLinesToSimulate) break;
            }
            if (pLineIdx >= maxLinesToSimulate) break;
        }

        // If we ran out of frames, just pad with default width
        while (pLineIdx < maxLinesToSimulate) {
            widths.push(defaultWidth || 200);
            pLineIdx++;
        }

        return widths;
    }

    getMinAvailableWidth(
        colX: number, colWidth: number, colY: number, colHeight: number, lineHeight: number,
    ): number {
        if (this._wrapPolygons.length === 0) return colWidth;
        let minWidth = colWidth;
        const step = Math.max(lineHeight, 4);
        for (let y = colY; y < colY + colHeight; y += step) {
            const intervals = this._scanlineEngine.getRectIntervals(colX, colWidth, this._wrapPolygons, y, lineHeight);
            if (intervals.length === 0) continue;
            const best = intervals.reduce((a, b) => b.x < a.x ? b : a);
            if (best.width < minWidth) minWidth = best.width;
        }
        return minWidth;
    }

    buildComposedLines(
        elements: KnuthPlassElement[],
        breaks: LineBreak[],
        paraStyle: ParagraphStyle,
    ): ComposedLine[] {
        const lines: ComposedLine[] = [];
        let startIdx = 0;
        const defaultFontSize = 14;

        for (const brk of breaks) {
            const lineElements = extractLineElements(elements, startIdx, brk.breakIndex);

            while (lineElements.length > 0) {
                const tail = lineElements[lineElements.length - 1]!;
                if (tail.type === 'glue' || tail.type === 'penalty') lineElements.pop();
                else break;
            }

            let maxLineHeight = 0;
            for (const el of lineElements) {
                if (el.type === 'box') {
                    const charLeading = el.style.leading ?? paraStyle.leading;
                    const h = el.style.fontSize * charLeading;
                    if (h > maxLineHeight) maxLineHeight = h;
                }
            }

            let lineHeight = maxLineHeight;
            if (lineHeight === 0) lineHeight = defaultFontSize * paraStyle.leading;

            let lineStartOffset = 0;
            let lineEndOffset = 0;
            for (const el of lineElements) {
                if (el.type === 'box') {
                    if (lineStartOffset === 0) lineStartOffset = el.startOffset;
                    lineEndOffset = el.endOffset;
                }
            }

            if (lineElements.length === 0) {
                const breakEl = elements[brk.breakIndex] as any;
                if (breakEl) {
                    lineStartOffset = breakEl.offset ?? breakEl.startOffset ?? 0;
                    lineEndOffset = lineStartOffset;
                }
            }

            lines.push({
                elements: lineElements,
                adjustmentRatio: brk.adjustmentRatio,
                baselineY: 0, startX: 0, width: 0,
                lineHeight,
                startOffset: lineStartOffset,
                endOffset: lineEndOffset,
                alignment: paraStyle.alignment,
                opticalMargins: paraStyle.opticalMargins,
            });

            startIdx = brk.breakIndex + 1;
            while (startIdx < elements.length && elements[startIdx]?.type === 'glue') startIdx++;
        }

        return lines;
    }

    private _positionGlyphs(
        line: ComposedLine,
        _columnWidth: number,
        alignment: TextAlignment,
        isLastLine: boolean,
    ): PositionedGlyph[] {
        const positioned: PositionedGlyph[] = [];
        const { elements, adjustmentRatio, baselineY, startX } = line;

        const shouldJustify =
            (alignment === 'justify' && !isLastLine) ||
            alignment === 'forceJustify';

        const naturalBoxWidth = elements
            .filter(el => el.type === 'box')
            .reduce((sum, el) => sum + (el.type === 'box' ? el.width : 0), 0);

        const hzLineScale = computeLineScale(naturalBoxWidth, _columnWidth, adjustmentRatio, DEFAULT_HZ_CONFIG);

        // If the layout engine squeezed this line (adjustmentRatio < 0) to fit a narrow bounds,
        // we MUST apply the shrink scaling even if we are left-aligned, otherwise it visually overflows.
        const lineScale = (shouldJustify || adjustmentRatio < 0) ? hzLineScale : 1.0;

        let x = startX;

        for (const el of elements) {
            if (el.type === 'box') {
                let glyphX = x;
                for (const item of el.glyphs) {
                    const glyph = item.glyph;
                    const advance = this._fontManager.fontUnitsToPixels(glyph.xAdvance, el.style.fontSize, el.style.fontFamily);
                    const xOff = this._fontManager.fontUnitsToPixels(glyph.xOffset, el.style.fontSize, el.style.fontFamily);
                    const yOff = this._fontManager.fontUnitsToPixels(glyph.yOffset, el.style.fontSize, el.style.fontFamily);

                    positioned.push({
                        glyphId: glyph.glyphId,
                        char: item.char,
                        charOffset: item.charOffset,
                        x: glyphX + xOff,
                        y: baselineY - yOff,
                        fontSize: el.style.fontSize,
                        fontFamily: el.style.fontFamily,
                        fontWeight: el.style.fontWeight,
                        fontStyle: el.style.fontStyle,
                        color: el.style.color,
                        scale: lineScale,
                        advance: advance * lineScale,
                    });

                    glyphX += advance * lineScale;
                }
                x = glyphX;
            } else if (el.type === 'glue') {
                let adjustedWidth = el.width;
                if (shouldJustify || adjustmentRatio < 0) {
                    adjustedWidth = adjustmentRatio >= 0
                        ? el.width + adjustmentRatio * el.stretch
                        : el.width + (adjustmentRatio * el.shrink);
                }
                x += adjustedWidth;
            }
        }

        return positioned;
    }
}
