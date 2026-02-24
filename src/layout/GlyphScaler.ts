/* ═══════════════════════════════════════════════════════════════
   GlyphScaler — Hz-Program Glyph Horizontal Scaling

   Based on the hz-program (Hermann Zapf / Adobe), which scales
   individual glyphs horizontally within a tolerance band (e.g.
   97–103%) to reduce the need for extreme inter-word spacing.

   This is applied PER LINE after Knuth-Plass line breaking, to
   fine-tune the fit of glyphs within the target line width.
   ═══════════════════════════════════════════════════════════════ */

export interface HzProgramConfig {
    /** Minimum horizontal scale factor, e.g. 0.97 */
    minScale: number;
    /** Maximum horizontal scale factor, e.g. 1.03 */
    maxScale: number;
}

export const DEFAULT_HZ_CONFIG: HzProgramConfig = {
    minScale: 0.97,
    maxScale: 1.03,
};

/**
 * Compute a horizontal glyph scale factor for a line.
 *
 * Given the total natural width of all box elements and the target
 * column width, returns a scale in [minScale, maxScale] or 1.0.
 *
 * @param naturalBoxWidth  Sum of box widths after glue adjustment
 * @param targetLineWidth  Desired total line width (column width)
 * @param adjustmentRatio  Knuth-Plass adjustment ratio for this line
 * @param config           Hz-program scale limits
 */
export function computeLineScale(
    naturalBoxWidth: number,
    targetLineWidth: number,
    adjustmentRatio: number,
    config: HzProgramConfig = DEFAULT_HZ_CONFIG,
): number {
    if (naturalBoxWidth <= 0) return 1.0;

    // Only apply hz scaling when adjustment ratio is extreme
    // (too tight or too loose) — otherwise let KP spacing handle it.
    const ABS_RATIO_THRESHOLD = 0.5;
    if (Math.abs(adjustmentRatio) < ABS_RATIO_THRESHOLD) return 1.0;

    // How much scale would perfectly fill the target width?
    const idealScale = targetLineWidth / naturalBoxWidth;

    // Clamp to permitted range
    return Math.min(config.maxScale, Math.max(config.minScale, idealScale));
}
