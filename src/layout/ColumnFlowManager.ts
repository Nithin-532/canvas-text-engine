/* ═══════════════════════════════════════════════════════════════
   ColumnFlowManager — Text Distribution Engine
   
   Takes composed lines from ParagraphComposer and distributes
   them across columns within TextFrames, handling:
   - Multi-column layout
   - Frame-to-frame text threading
   - Overset text detection
   - Line positioning (baseline calculations)
   - Justification application
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

/**
 * Extract the elements for a specific line from the break list.
 */
function extractLineElements(
    elements: KnuthPlassElement[],
    startElementIdx: number,
    breakIdx: number,
): KnuthPlassElement[] {
    const lineElements: KnuthPlassElement[] = [];

    for (let i = startElementIdx; i <= breakIdx; i++) {
        const el = elements[i]!;

        // Skip leading glue
        if (lineElements.length === 0 && el.type === 'glue') continue;

        // Don't include the break penalty itself in the line content
        if (i === breakIdx && el.type === 'penalty') continue;

        // Don't include trailing glue as the last element
        if (i === breakIdx && el.type === 'glue') continue;

        lineElements.push(el);
    }

    return lineElements;
}

/**
 * Calculate the natural width of a sequence of elements.
 */
function naturalWidth(elements: KnuthPlassElement[]): number {
    return elements.reduce((sum, el) => {
        if (el.type === 'box') return sum + el.width;
        if (el.type === 'glue') return sum + el.width;
        return sum;
    }, 0);
}

/**
 * Calculate the starting X position for horizontal alignment.
 */
function alignmentOffset(
    lineWidth: number,
    targetWidth: number,
    alignment: TextAlignment,
    isLastLine: boolean,
): number {
    switch (alignment) {
        case 'left':
            return 0;
        case 'right':
            return targetWidth - lineWidth;
        case 'center':
            return (targetWidth - lineWidth) / 2;
        case 'justify':
            // Last line of paragraph is left-aligned for justify
            return isLastLine ? 0 : 0;
        case 'forceJustify':
            return 0;
        default:
            return 0;
    }
}

export class ColumnFlowManager {
    private _fontManager: FontManager;

    constructor(fontManager: FontManager) {
        this._fontManager = fontManager;
    }

    /**
     * Distribute composed lines into columns and frames.
     * This is the main layout entry point.
     * 
     * @param elements  The Box/Glue/Penalty element stream
     * @param breaks    The Knuth-Plass or greedy break results
     * @param paraStyle The paragraph style (alignment, leading, etc.)
     * @param frames    The FrameManager containing all text frames
     * @param startFrameId  Which frame to start flowing text into
     * @returns LayoutResult with frames, columns, lines, and positioned glyphs
     */
    distribute(
        lines: ComposedLine[],
        frameManager: FrameManager,
        startFrameId: string,
    ): LayoutResult {
        const startTime = performance.now();
        const frameLayouts: FrameLayout[] = [];
        const allGlyphs: PositionedGlyph[] = [];

        // Get the thread of frames
        const thread = frameManager.getThread(startFrameId);
        if (thread.length === 0) {
            return {
                frames: [],
                glyphs: [],
                composeTimeMs: performance.now() - startTime,
                lineCount: 0,
                glyphCount: 0,
            };
        }

        // Distribute lines across frames and columns
        let lineIdx = 0;

        console.log("Distributing", lines.length, "lines. Heights:", lines.map(l => l.lineHeight));

        for (const frame of thread) {
            const columnGeometries = frame.getColumnGeometries();
            const columns: ColumnLayout[] = columnGeometries.map((geo, idx) => ({
                index: idx,
                x: geo.x,
                y: geo.y,
                width: geo.width,
                height: geo.height,
                lines: [],
            }));

            // Fill each column
            for (const column of columns) {
                let currentY = column.y;

                while (lineIdx < lines.length) {
                    const line = lines[lineIdx]!;
                    const lineHeight = line.lineHeight;

                    // Check if this line fits in the column
                    if (currentY + lineHeight > column.y + column.height) {
                        break; // Column full — move to next column
                    }

                    // Position the line within this column
                    const positionedLine: ComposedLine = {
                        ...line,
                        baselineY: currentY + lineHeight * 0.8, // Approximate baseline at 80% of line height
                        startX: column.x + alignmentOffset(
                            naturalWidth(line.elements),
                            column.width,
                            line.alignment,
                            lineIdx === lines.length - 1 || lines[lineIdx + 1]?.alignment !== line.alignment,
                        ),
                        width: column.width,
                    };

                    // Apply optical margin alignment indent if enabled
                    // We peek the first/last glyph character of the line
                    if ((line as any).opticalMargins && line.elements.length > 0) {
                        // Find first printable char → outdent LEFT
                        for (const el of line.elements) {
                            if (el.type === 'box' && el.glyphs.length > 0) {
                                const firstChar = el.glyphs[0]?.char ?? '';
                                const firstGlyphWidth = this._fontManager.fontUnitsToPixels(
                                    el.glyphs[0]!.glyph.xAdvance,
                                    el.style.fontSize,
                                    el.style.fontFamily,
                                );
                                const leadIndent = getLeadingIndent(firstChar, firstGlyphWidth);
                                if (leadIndent > 0) {
                                    (positionedLine as ComposedLine).startX -= leadIndent;
                                    (positionedLine as ComposedLine).width += leadIndent;
                                }
                                break;
                            }
                        }
                        // Find last printable char → outdent RIGHT
                        for (let ei = line.elements.length - 1; ei >= 0; ei--) {
                            const el = line.elements[ei]!;
                            if (el.type === 'box' && el.glyphs.length > 0) {
                                const lastGlyph = el.glyphs[el.glyphs.length - 1]!;
                                const lastChar = lastGlyph.char ?? '';
                                const lastGlyphWidth = this._fontManager.fontUnitsToPixels(
                                    lastGlyph.glyph.xAdvance,
                                    el.style.fontSize,
                                    el.style.fontFamily,
                                );
                                const trailIndent = getTrailingIndent(lastChar, lastGlyphWidth);
                                if (trailIndent > 0) {
                                    (positionedLine as ComposedLine).width += trailIndent;
                                }
                                break;
                            }
                        }
                    }

                    // Apply justification to position individual glyphs
                    const lineGlyphs = this._positionGlyphs(
                        positionedLine,
                        column.width,
                        line.alignment,
                        lineIdx === lines.length - 1 || lines[lineIdx + 1]?.alignment !== line.alignment,
                    );
                    allGlyphs.push(...lineGlyphs);

                    column.lines.push(positionedLine);
                    currentY += lineHeight;
                    lineIdx++;
                }
            }

            frameLayouts.push({
                frameId: frame.id,
                columns,
                isOverset: false,
            });

            // Check if all lines have been placed
            if (lineIdx >= lines.length) break;
        }

        // Check for overset
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
     * Build ComposedLine objects from the element stream and break points.
     */
    buildComposedLines(
        elements: KnuthPlassElement[],
        breaks: LineBreak[],
        paraStyle: ParagraphStyle,
    ): ComposedLine[] {
        const lines: ComposedLine[] = [];
        let startIdx = 0;

        // Determine font size for line height calculation
        const defaultFontSize = 14; // Fallback

        for (const brk of breaks) {
            const lineElements = extractLineElements(elements, startIdx, brk.breakIndex);

            // Strip trailing penalty/glue to ensure naturalWidth calculation does not trigger overshoot on margin bounds.
            while (lineElements.length > 0) {
                const tail = lineElements[lineElements.length - 1]!;
                if (tail.type === 'glue' || tail.type === 'penalty') {
                    lineElements.pop();
                } else {
                    break;
                }
            }

            // Get the maximum font size * leading from the elements in this line
            let maxLineHeight = 0;
            for (const el of lineElements) {
                if (el.type === 'box') {
                    const charLeading = el.style.leading ?? paraStyle.leading;
                    const h = el.style.fontSize * charLeading;
                    if (h > maxLineHeight) {
                        maxLineHeight = h;
                    }
                }
            }

            let lineHeight = maxLineHeight;
            if (lineHeight === 0) {
                // Fallback for empty lines (e.g. multiple enters where lineElements has no text boxes)
                lineHeight = defaultFontSize * paraStyle.leading;
            }

            // Get text offsets
            let lineStartOffset = 0;
            let lineEndOffset = 0;
            for (const el of lineElements) {
                if (el.type === 'box') {
                    if (lineStartOffset === 0) lineStartOffset = el.startOffset;
                    lineEndOffset = el.endOffset;
                }
            }

            // Fallback for empty lines (e.g. multiple Enters) where lineElements has no text boxes
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
                baselineY: 0, // Will be set during distribution
                startX: 0,    // Will be set during distribution
                width: 0,     // Will be set during distribution
                lineHeight,
                startOffset: lineStartOffset,
                endOffset: lineEndOffset,
                alignment: paraStyle.alignment,
                opticalMargins: paraStyle.opticalMargins,
            });

            // Move start index past the break
            startIdx = brk.breakIndex + 1;

            // Skip any leading glue after the break
            while (startIdx < elements.length && elements[startIdx]?.type === 'glue') {
                startIdx++;
            }
        }

        return lines;
    }

    /**
     * Position individual glyphs within a composed line,
     * applying justification and tracking.
     */
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

        // — Hz-program glyph scaling —
        // Compute the natural width of all boxes on this line
        const naturalBoxWidth = elements
            .filter(el => el.type === 'box')
            .reduce((sum, el) => sum + (el.type === 'box' ? el.width : 0), 0);

        // Determine the hz config from the line's paragraph style (stored on composedLine via alignment etc.)
        // We use the line's adjustment ratio: if KP had to stretch/shrink a lot, apply hz scaling
        const hzLineScale = computeLineScale(
            naturalBoxWidth,
            _columnWidth,
            adjustmentRatio,
            DEFAULT_HZ_CONFIG,
        );
        const lineScale = shouldJustify ? hzLineScale : 1.0;

        let x = startX;

        for (const el of elements) {
            if (el.type === 'box') {
                // Position each glyph in this box
                let glyphX = x;

                for (const item of el.glyphs) {
                    const glyph = item.glyph;
                    const advance = this._fontManager.fontUnitsToPixels(
                        glyph.xAdvance,
                        el.style.fontSize,
                        el.style.fontFamily,
                    );
                    const xOff = this._fontManager.fontUnitsToPixels(
                        glyph.xOffset,
                        el.style.fontSize,
                        el.style.fontFamily,
                    );
                    const yOff = this._fontManager.fontUnitsToPixels(
                        glyph.yOffset,
                        el.style.fontSize,
                        el.style.fontFamily,
                    );

                    positioned.push({
                        glyphId: glyph.glyphId,
                        char: item.char,
                        charOffset: item.charOffset,
                        x: glyphX + xOff,
                        y: baselineY - yOff, // Flip Y for screen coordinates
                        fontSize: el.style.fontSize,
                        fontFamily: el.style.fontFamily,
                        fontWeight: el.style.fontWeight,
                        fontStyle: el.style.fontStyle,
                        color: el.style.color,
                        scale: lineScale, // hz-program scale factor
                    });

                    glyphX += advance * lineScale;
                }
                x = glyphX;
            } else if (el.type === 'glue') {
                // Apply adjustment ratio to glue
                let adjustedWidth = el.width;
                if (shouldJustify) {
                    if (adjustmentRatio >= 0) {
                        adjustedWidth = el.width + adjustmentRatio * el.stretch;
                    } else {
                        adjustedWidth = el.width + adjustmentRatio * el.shrink;
                    }
                }
                x += adjustedWidth;
            }
            // Penalties don't take up space in the line
        }

        return positioned;
    }
}
