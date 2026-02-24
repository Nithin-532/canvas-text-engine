/* ═══════════════════════════════════════════════════════════════
   Knuth-Plass Element Builder
   
   Converts a ShapedParagraph into the Box/Glue/Penalty stream
   that the Knuth-Plass algorithm operates on.
   ═══════════════════════════════════════════════════════════════ */

import type {
    ShapedRun,
    ShapedGlyph,
    KnuthPlassElement,
    BoxElement,
    CharacterStyle,
} from '../types';
import type { ShapedParagraph } from '../types';
import { PENALTY_FORCED } from '../shaping/TextSegmenter';

/**
 * Build a Knuth-Plass element stream from a shaped paragraph.
 * 
 * The output is a flat array of Box, Glue, and Penalty elements:
 * - Box: a word or glyph cluster (rigid width)
 * - Glue: a stretchable space between words
 * - Penalty: a legal break point with associated cost
 * 
 * The stream ends with a forced-break penalty (paragraph end).
 */
export function buildElements(
    shaped: ShapedParagraph,
    fontUnitsToPixels: (units: number, fontSize: number, family: string, weight?: number | string, style?: string) => number,
): KnuthPlassElement[] {
    const elements: KnuthPlassElement[] = [];
    const { runs, breakOpportunities, text, paragraphStyle: _paragraphStyle } = shaped;

    // Build a set of break offsets relative to paragraph text for quick lookup
    const breakMap = new Map(breakOpportunities.map((b) => [b.offset, b]));

    // Flatten all glyphs with their source info
    interface GlyphWithMeta {
        glyph: ShapedGlyph;
        style: CharacterStyle;
        charOffset: number; // offset within paragraph text
    }

    const allGlyphs: GlyphWithMeta[] = [];
    for (const run of runs) {
        const runTextStart = run.startOffset - (runs[0]?.startOffset ?? 0);
        for (const glyph of run.glyphs) {
            allGlyphs.push({
                glyph,
                style: run.style,
                charOffset: runTextStart + glyph.cluster,
            });
        }
    }

    if (allGlyphs.length === 0) {
        // Empty paragraph — still must be terminated by glue and infinite penalty 
        // to form a single empty line
        elements.push({
            type: 'glue', width: 0, stretch: 10000, shrink: 0, offset: runs[0]?.startOffset ?? 0,
        });
        elements.push({
            type: 'penalty',
            penalty: PENALTY_FORCED,
            width: 0,
            flagged: false,
            offset: runs[0]?.startOffset ?? 0,
        });
        return elements;
    }

    const paraStartOffset = runs[0]!.startOffset;

    // Walk through the text character by character, grouping into words
    let wordStart = 0;
    let i = 0;
    let currentStyle: CharacterStyle | null = null;

    while (i < text.length) {
        const ch = text[i]!;
        const g = findGlyphAtOffset(allGlyphs, i);
        const style = g ? g.style : (runs[0]?.style ?? null);

        // Split box if style changes mid-word
        if (i > wordStart && currentStyle && style && currentStyle !== style && ch !== ' ' && ch !== '\t' && ch !== '\n') {
            const box = buildBox(text, wordStart, i, allGlyphs, runs, fontUnitsToPixels);
            if (box) elements.push(box);

            // Unbreakable penalty tying them together
            elements.push({
                type: 'penalty', penalty: 10000, width: 0, flagged: false, offset: i
            });
            wordStart = i;
        }
        currentStyle = style;

        if (ch === ' ' || ch === '\t') {
            // Flush the word before this space as a Box
            if (i > wordStart) {
                const box = buildBox(text, wordStart, i, allGlyphs, runs, fontUnitsToPixels);
                if (box) elements.push(box);
            }

            // The space itself becomes Glue
            const spaceGlyph = findGlyphAtOffset(allGlyphs, i);
            const spaceWidth = spaceGlyph
                ? fontUnitsToPixels(spaceGlyph.glyph.xAdvance, spaceGlyph.style.fontSize, spaceGlyph.style.fontFamily, spaceGlyph.style.fontWeight, spaceGlyph.style.fontStyle)
                : runs[0]?.style.fontSize ? runs[0].style.fontSize * 0.25 : 3.5;

            // Standard inter-word glue: stretch = width/2, shrink = width/3
            elements.push({
                type: 'glue',
                width: spaceWidth,
                stretch: spaceWidth * 0.5,
                shrink: spaceWidth * 0.33,
                offset: i + paraStartOffset,
            });

            i++;
            wordStart = i;

            // Check if there's a break opportunity here
            const breakOp = breakMap.get(i);
            if (breakOp && breakOp.type !== 'mandatory') {
                // Break opportunity after space — add penalty of 0 (allowed)
                elements.push({
                    type: 'penalty',
                    penalty: 0,
                    width: 0,
                    flagged: false,
                    offset: i,
                });
            }
        } else if (ch === '\n') {
            // Flush word
            if (i > wordStart) {
                const box = buildBox(text, wordStart, i, allGlyphs, runs, fontUnitsToPixels);
                if (box) elements.push(box);
            }

            // Forced break (paragraph end or explicit line break within paragraph)
            elements.push({
                type: 'penalty',
                penalty: PENALTY_FORCED,
                width: 0,
                flagged: false,
                offset: i + paraStartOffset,
            });

            i++;
            wordStart = i;
            currentStyle = null;
        } else {
            // Check for mid-word break opportunities (hyphens, dashes)
            const breakOp = breakMap.get(i);
            if (breakOp && breakOp.type === 'hyphen' && i > wordStart) {
                // Flush the word up to here as a Box
                const box = buildBox(text, wordStart, i, allGlyphs, runs, fontUnitsToPixels);
                if (box) elements.push(box);

                // Hyphenation penalty
                const style = allGlyphs[0]?.style ?? runs[0]?.style;
                const hyphenWidth = style
                    ? fontUnitsToPixels(
                        style.fontSize * 0.3 * (allGlyphs[0]?.glyph ? 1 : 1),
                        style.fontSize,
                        style.fontFamily,
                        style.fontWeight,
                        style.fontStyle
                    )
                    : 4;

                elements.push({
                    type: 'penalty',
                    penalty: breakOp.penalty,
                    width: hyphenWidth,
                    flagged: true,
                    offset: i + paraStartOffset,
                });

                wordStart = i;
            } else if (breakOp && breakOp.type === 'allowed' && i > wordStart) {
                // Break after dash/hyphen characters
                const box = buildBox(text, wordStart, i, allGlyphs, runs, fontUnitsToPixels);
                if (box) elements.push(box);

                elements.push({
                    type: 'penalty',
                    penalty: breakOp.penalty,
                    width: 0,
                    flagged: false,
                    offset: i + paraStartOffset,
                });

                wordStart = i;
            }

            i++;
        }
    }

    // Flush final word
    if (wordStart < text.length) {
        const box = buildBox(text, wordStart, text.length, allGlyphs, runs, fontUnitsToPixels);
        if (box) elements.push(box);
    }

    // End the paragraph with finishing glue + forced penalty
    // The finishing glue gives infinite stretch to fill the last line
    elements.push({
        type: 'glue',
        width: 0,
        stretch: 10000,
        shrink: 0,
        offset: text.length + paraStartOffset,
    });
    elements.push({
        type: 'penalty',
        penalty: PENALTY_FORCED,
        width: 0,
        flagged: false,
        offset: text.length + paraStartOffset,
    });

    return elements;
}

/**
 * Build a Box element from a range of characters.
 */
function buildBox(
    _text: string,
    start: number,
    end: number,
    allGlyphs: Array<{ glyph: ShapedGlyph; style: CharacterStyle; charOffset: number }>,
    runs: ShapedRun[],
    fontUnitsToPixels: (units: number, fontSize: number, family: string, weight?: number | string, style?: string) => number,
): BoxElement | null {
    // Find glyphs that fall within this character range
    const boxGlyphs: Array<{ glyph: ShapedGlyph; charOffset: number; char: string }> = [];
    let style = runs[0]?.style;

    for (let i = 0; i < allGlyphs.length; i++) {
        const g = allGlyphs[i]!;
        if (g.charOffset >= start && g.charOffset < end) {
            // Find the character offset of the *next* glyph to know how many characters this glyph represents.
            // If this is the last glyph in the bounds, it represents the rest of the text up to `end`.
            let nextCharOffset = end;
            if (i + 1 < allGlyphs.length) {
                const nextG = allGlyphs[i + 1]!;
                // Only use the next glyph's offset if it's actually further along (handles zero-width joiners etc gracefully if they don't advance offset, though harfbuzz clusters usually handle this).
                // But for standard ligatures like 'fi' (2 chars -> 1 glyph), nextG.charOffset will be g.charOffset + 2.
                if (nextG.charOffset <= end && nextG.charOffset > g.charOffset) {
                    nextCharOffset = nextG.charOffset;
                }
            }

            boxGlyphs.push({
                glyph: g.glyph,
                charOffset: g.charOffset,
                char: _text.slice(g.charOffset, nextCharOffset),
            });
            style = g.style;
        }
    }

    if (!style) return null;

    // Calculate total width in pixels
    const widthFontUnits = boxGlyphs.reduce((sum, g) => sum + g.glyph.xAdvance, 0);
    const widthPixels = fontUnitsToPixels(widthFontUnits, style.fontSize, style.fontFamily, style.fontWeight, style.fontStyle);

    // Add tracking if specified
    const trackingPixels = style.tracking ? style.tracking * style.fontSize * (end - start - 1) : 0;

    const paraStartOffset = runs.length > 0 ? runs[0]!.startOffset : 0;

    // Convert internal charOffset to absolute offset for elements
    const absBoxGlyphs = boxGlyphs.map(bg => ({
        ...bg,
        charOffset: bg.charOffset + paraStartOffset
    }));

    return {
        type: 'box',
        width: widthPixels + trackingPixels,
        glyphs: absBoxGlyphs,
        startOffset: start + paraStartOffset,
        endOffset: end + paraStartOffset,
        style,
        // Hz-program: each box can stretch/shrink up to 3% of its own width
        microStretch: (widthPixels + trackingPixels) * 0.03,
        microShrink: (widthPixels + trackingPixels) * 0.03,
    };
}

/**
 * Find the glyph metadata at a specific text offset.
 */
function findGlyphAtOffset(
    allGlyphs: Array<{ glyph: ShapedGlyph; style: CharacterStyle; charOffset: number }>,
    offset: number,
): { glyph: ShapedGlyph; style: CharacterStyle } | null {
    for (const g of allGlyphs) {
        if (g.charOffset === offset) return g;
    }
    return null;
}
