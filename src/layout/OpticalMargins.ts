/* ═══════════════════════════════════════════════════════════════
   OpticalMargins — Optical Margin Alignment (Hanging Punctuation)

   Optical margin alignment lets punctuation characters protrude
   slightly beyond the column edge so the text block has a visually
   straight margin — as in Adobe InDesign's "Story > Optical Margin
   Alignment" feature.

   This module provides:
   1. OPTICAL_OUTDENT_TABLE  — map of char → [leftOutdent, rightOutdent]
      where outdents are fractions of the glyph's rendered width (0–1).

   2. getLeadingIndent()   — px to shift startX *left* for first char
   3. getTrailingIndent()  — px to hang last char *right* of column edge
   ═══════════════════════════════════════════════════════════════ */

/**
 * Optical outdent fractions [leftFraction, rightFraction].
 * leftFraction:  how much of glyph width hangs left of the column edge
 * rightFraction: how much of glyph width hangs right of the column edge
 */
export type OutdentEntry = [left: number, right: number];

/**
 * Character classification table for optical outdent.
 * Values are fractions of the glyph's advance width (0.0 – 1.0).
 *
 * References:
 *  - Adobe InDesign optical margin alignment
 *  - W3C CSS Text Level 4 §hanging-punctuation
 *  - Bringhurst "The Elements of Typographic Style" §2.4
 */
export const OPTICAL_OUTDENT_TABLE: Map<string, OutdentEntry> = new Map([
    // ── Quotation marks ──
    ['"', [0.5, 0.0]],   // Neutral double quote — can be on either side
    ["'", [0.5, 0.0]],   // Neutral single quote
    ['\u201C', [0.7, 0.0]],  // " LEFT double quotation mark
    ['\u201D', [0.0, 0.7]],  // " RIGHT double quotation mark
    ['\u2018', [0.7, 0.0]],  // ' LEFT single quotation mark
    ['\u2019', [0.0, 0.7]],  // ' RIGHT single quotation mark
    ['\u00AB', [0.5, 0.0]],  // « LEFT-POINTING double angle quotation mark
    ['\u00BB', [0.0, 0.5]],  // » RIGHT-POINTING double angle quotation mark

    // ── Hyphens and dashes ──
    ['-', [0.0, 0.8]],  // Hyphen-minus
    ['\u2010', [0.0, 0.8]],  // ‐ HYPHEN
    ['\u2011', [0.0, 0.8]],  // ‑ NON-BREAKING HYPHEN
    ['\u2013', [0.0, 0.7]],  // – EN DASH
    ['\u2014', [0.0, 0.6]],  // — EM DASH
    ['\u2015', [0.0, 0.6]],  // ― HORIZONTAL BAR

    // ── Terminals (period, comma, semicolon, colon) ──
    ['.', [0.0, 0.5]],
    [',', [0.0, 0.5]],
    [';', [0.0, 0.3]],
    [':', [0.0, 0.3]],
    ['\u2026', [0.0, 0.3]],  // … ELLIPSIS

    // ── End-of-sentence punctuation ──
    ['!', [0.0, 0.3]],
    ['?', [0.0, 0.3]],

    // ── Brackets / parentheses ──
    ['(', [0.4, 0.0]],
    [')', [0.0, 0.4]],
    ['[', [0.4, 0.0]],
    [']', [0.0, 0.4]],
    ['{', [0.4, 0.0]],
    ['}', [0.0, 0.4]],

    // ── Asterisk / slash ──
    ['*', [0.0, 0.3]],
    ['/', [0.0, 0.3]],
]);

/**
 * Get the LEFT optical indent (how many CSS pixels to shift startX to
 * the LEFT) for a given first character on a line.
 *
 * @param char      The first character of the line
 * @param glyphWidth The advance width of that glyph in pixels
 * @returns Positive number of pixels to shift startX left (outdent)
 */
export function getLeadingIndent(char: string, glyphWidth: number): number {
    const entry = OPTICAL_OUTDENT_TABLE.get(char);
    if (!entry) return 0;
    return entry[0] * glyphWidth;
}

/**
 * Get the RIGHT optical indent (how many additional CSS pixels the last
 * glyph on a line may overhang beyond the column's right edge).
 *
 * @param char      The last character of the line
 * @param glyphWidth The advance width of that glyph in pixels
 * @returns Positive number of pixels the character may hang right
 */
export function getTrailingIndent(char: string, glyphWidth: number): number {
    const entry = OPTICAL_OUTDENT_TABLE.get(char);
    if (!entry) return 0;
    return entry[1] * glyphWidth;
}
