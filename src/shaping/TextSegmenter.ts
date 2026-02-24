/* ═══════════════════════════════════════════════════════════════
   TextSegmenter — Unicode Boundary Detection
   
   Uses Intl.Segmenter for word/grapheme boundaries and
   implements UAX #14 line-break classification for determining
   where lines can legally break.
   ═══════════════════════════════════════════════════════════════ */

import type { BreakOpportunity } from '../types';

/** Infinity penalty — never break here */
const PENALTY_NEVER = 10000;
/** Forced break — must break here */
const PENALTY_FORCED = -10000;
/** Normal word boundary break */
const PENALTY_WORD = 0;
/** Hyphenation break — slightly discouraged */
const PENALTY_HYPHEN = 50;

export class TextSegmenter {
    private _wordSegmenter: Intl.Segmenter;
    private _graphemeSegmenter: Intl.Segmenter;

    constructor(locale: string = 'en') {
        this._wordSegmenter = new Intl.Segmenter(locale, { granularity: 'word' });
        this._graphemeSegmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    }

    /**
     * Find all legal line-break opportunities in a text string.
     * 
     * Returns break opportunities sorted by offset. The Knuth-Plass
     * algorithm uses these to place Penalty elements in the element stream.
     */
    findBreakOpportunities(text: string): BreakOpportunity[] {
        const breaks: BreakOpportunity[] = [];

        if (text.length === 0) return breaks;

        // Use word segmenter to find word boundaries
        const wordSegments = this._wordSegmenter.segment(text);

        for (const segment of wordSegments) {
            const endOffset = segment.index + segment.segment.length;

            // Break opportunity exists at the end of each word-like segment
            if (endOffset < text.length) {
                if (segment.isWordLike) {
                    // After a word — check what follows
                    const nextChar = text[endOffset]!;
                    if (nextChar === ' ' || nextChar === '\t') {
                        // Break after the space (standard word boundary)
                        breaks.push({
                            offset: endOffset,
                            type: 'allowed',
                            penalty: PENALTY_WORD,
                        });
                    }
                }
            }
        }

        // Find mandatory breaks (newlines, paragraph separators)
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (
                code === 0x000A || // LF
                code === 0x000D || // CR
                code === 0x2028 || // Line Separator
                code === 0x2029    // Paragraph Separator
            ) {
                breaks.push({
                    offset: i,
                    type: 'mandatory',
                    penalty: PENALTY_FORCED,
                });
            }
        }

        // Find hyphenation opportunities (soft hyphens in the text)
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 0x00AD) { // Soft hyphen
                breaks.push({
                    offset: i,
                    type: 'hyphen',
                    penalty: PENALTY_HYPHEN,
                });
            }
        }

        // Additional: break opportunities after hyphens and en/em dashes
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (
                code === 0x002D || // Hyphen-Minus
                code === 0x2010 || // Hyphen
                code === 0x2013 || // En Dash
                code === 0x2014    // Em Dash
            ) {
                if (i + 1 < text.length) {
                    breaks.push({
                        offset: i + 1,
                        type: 'allowed',
                        penalty: PENALTY_WORD,
                    });
                }
            }
        }

        // Sort by offset, remove duplicates
        breaks.sort((a, b) => a.offset - b.offset);
        const unique: BreakOpportunity[] = [];
        for (const b of breaks) {
            if (unique.length === 0 || unique[unique.length - 1]!.offset !== b.offset) {
                unique.push(b);
            } else {
                // Keep the one with lower (more encouraging) penalty
                const last = unique[unique.length - 1]!;
                if (b.penalty < last.penalty) {
                    unique[unique.length - 1] = b;
                }
            }
        }

        return unique;
    }

    /**
     * Segment text into grapheme clusters.
     * Essential for correct cursor movement and selection in complex scripts.
     */
    segmentGraphemes(text: string): Array<{ index: number; segment: string }> {
        const segments: Array<{ index: number; segment: string }> = [];
        for (const seg of this._graphemeSegmenter.segment(text)) {
            segments.push({ index: seg.index, segment: seg.segment });
        }
        return segments;
    }

    /**
     * Segment text into words.
     */
    segmentWords(text: string): Array<{ index: number; segment: string; isWordLike: boolean }> {
        const segments: Array<{ index: number; segment: string; isWordLike: boolean }> = [];
        for (const seg of this._wordSegmenter.segment(text)) {
            segments.push({ index: seg.index, segment: seg.segment, isWordLike: seg.isWordLike ?? false });
        }
        return segments;
    }
}

export { PENALTY_NEVER, PENALTY_FORCED, PENALTY_WORD, PENALTY_HYPHEN };
