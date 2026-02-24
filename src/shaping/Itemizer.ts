/* ═══════════════════════════════════════════════════════════════
   Itemizer — Text Run Decomposition
   
   Splits Story text into uniform Runs based on:
   - Character style changes
   - Script boundaries (Latin vs Arabic vs CJK)
   - BiDi direction changes
   
   Each Run is the smallest unit that can be independently shaped.
   ═══════════════════════════════════════════════════════════════ */

import type { CharacterStyle } from '../types';
import { Story } from '../core/Story';

/** A text run with uniform properties for HarfBuzz shaping */
export interface TextRun {
    text: string;
    startOffset: number;
    endOffset: number;
    style: CharacterStyle;
    direction: 'ltr' | 'rtl';
    script: string;
}

/**
 * Simple script detection based on Unicode ranges.
 * Returns an ISO 15924 script tag.
 */
function detectScript(codePoint: number): string {
    // Latin
    if (
        (codePoint >= 0x0041 && codePoint <= 0x024F) || // Basic Latin + Latin Extended
        (codePoint >= 0x1E00 && codePoint <= 0x1EFF)    // Latin Extended Additional
    ) return 'Latn';

    // Arabic
    if (codePoint >= 0x0600 && codePoint <= 0x06FF) return 'Arab';
    if (codePoint >= 0xFE70 && codePoint <= 0xFEFF) return 'Arab';

    // Devanagari
    if (codePoint >= 0x0900 && codePoint <= 0x097F) return 'Deva';

    // CJK
    if (
        (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||  // CJK Unified
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||  // CJK Extension A
        (codePoint >= 0x3000 && codePoint <= 0x303F)     // CJK Symbols
    ) return 'Hani';

    // Hiragana
    if (codePoint >= 0x3040 && codePoint <= 0x309F) return 'Hira';

    // Katakana
    if (codePoint >= 0x30A0 && codePoint <= 0x30FF) return 'Kana';

    // Hangul
    if (codePoint >= 0xAC00 && codePoint <= 0xD7AF) return 'Hang';

    // Thai
    if (codePoint >= 0x0E00 && codePoint <= 0x0E7F) return 'Thai';

    // Default — Common (numbers, punctuation, spaces)
    return 'Zyyy';
}

/**
 * Simple BiDi direction detection based on Unicode character type.
 */
function detectDirection(codePoint: number): 'ltr' | 'rtl' | 'neutral' {
    // Arabic, Hebrew, etc.
    if (
        (codePoint >= 0x0590 && codePoint <= 0x05FF) || // Hebrew
        (codePoint >= 0x0600 && codePoint <= 0x06FF) || // Arabic
        (codePoint >= 0x0700 && codePoint <= 0x074F) || // Syriac
        (codePoint >= 0xFB50 && codePoint <= 0xFDFF) || // Arabic Presentation A
        (codePoint >= 0xFE70 && codePoint <= 0xFEFF)    // Arabic Presentation B
    ) return 'rtl';

    // Most other visible characters are LTR
    if (codePoint > 0x0040) return 'ltr';

    return 'neutral';
}

/**
 * Compare two character styles for equality.
 */
function stylesEqual(a: CharacterStyle, b: CharacterStyle): boolean {
    return (
        a.fontFamily === b.fontFamily &&
        a.fontSize === b.fontSize &&
        a.fontWeight === b.fontWeight &&
        a.fontStyle === b.fontStyle &&
        a.color === b.color &&
        a.tracking === b.tracking &&
        a.leading === b.leading
    );
}

export class Itemizer {
    /**
     * Split a paragraph's text into uniform runs based on style, script, and direction.
     * 
     * Each returned TextRun can be independently passed to HarfBuzz for shaping.
     */
    itemize(text: string, startOffset: number, story: Story): TextRun[] {
        if (text.length === 0) return [];

        const runs: TextRun[] = [];
        let runStart = 0;
        let currentStyle = story.getCharacterStyleAt(startOffset);
        let currentScript = 'Zyyy';
        let currentDirection: 'ltr' | 'rtl' = 'ltr';

        // Set initial script from first non-neutral character
        for (let i = 0; i < text.length; i++) {
            const cp = text.codePointAt(i)!;
            const script = detectScript(cp);
            if (script !== 'Zyyy') {
                currentScript = script;
                break;
            }
        }

        // Set initial direction from first non-neutral character
        for (let i = 0; i < text.length; i++) {
            const cp = text.codePointAt(i)!;
            const dir = detectDirection(cp);
            if (dir !== 'neutral') {
                currentDirection = dir;
                break;
            }
        }

        for (let i = 0; i < text.length; i++) {
            const cp = text.codePointAt(i)!;
            const charStyle = story.getCharacterStyleAt(startOffset + i);
            const script = detectScript(cp);
            const dir = detectDirection(cp);

            // Determine effective script (inherit for common chars)
            const effectiveScript = script === 'Zyyy' ? currentScript : script;
            const effectiveDir = dir === 'neutral' ? currentDirection : dir;

            // Check if we need to break the run
            const styleChanged = !stylesEqual(charStyle, currentStyle);
            const scriptChanged = effectiveScript !== currentScript && script !== 'Zyyy';
            const dirChanged = effectiveDir !== currentDirection && dir !== 'neutral';

            if ((styleChanged || scriptChanged || dirChanged) && i > runStart) {
                // Flush the current run
                runs.push({
                    text: text.slice(runStart, i),
                    startOffset: startOffset + runStart,
                    endOffset: startOffset + i,
                    style: currentStyle,
                    direction: currentDirection,
                    script: currentScript,
                });
                runStart = i;
                currentStyle = charStyle;
                if (scriptChanged) currentScript = effectiveScript;
                if (dirChanged) currentDirection = effectiveDir;
            } else {
                if (script !== 'Zyyy') currentScript = effectiveScript;
                if (dir !== 'neutral') currentDirection = effectiveDir;
            }

            // Handle surrogate pairs (codepoints > 0xFFFF use 2 UTF-16 code units)
            if (cp > 0xFFFF) i++;
        }

        // Flush the last run
        if (runStart < text.length) {
            runs.push({
                text: text.slice(runStart),
                startOffset: startOffset + runStart,
                endOffset: startOffset + text.length,
                style: currentStyle,
                direction: currentDirection,
                script: currentScript,
            });
        }

        return runs;
    }
}
