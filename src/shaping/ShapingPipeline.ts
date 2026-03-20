/* ═══════════════════════════════════════════════════════════════
   ShapingPipeline — Orchestrator
   
   The main orchestrator that coordinates:
   1. Story → paragraphs
   2. Itemizer → uniform runs
   3. TextSegmenter → break opportunities
   4. FontManager (HarfBuzz) → shaped glyphs
   
   Produces ShapedParagraph objects ready for the Knuth-Plass
   line-breaking algorithm.
   ═══════════════════════════════════════════════════════════════ */

import type { ShapedGlyph, ShapedRun, ShapedParagraph, BreakOpportunity, CharacterStyle } from '../types';
import { Story } from '../core/Story';
import { FontManager } from './FontManager';
import { TextSegmenter } from './TextSegmenter';
import { Itemizer } from './Itemizer';
import type { TextRun } from './Itemizer';

export class ShapingPipeline {
    private _fontManager: FontManager;
    private _segmenter: TextSegmenter;
    private _itemizer: Itemizer;

    constructor(fontManager: FontManager, locale: string = 'en') {
        this._fontManager = fontManager;
        this._segmenter = new TextSegmenter(locale);
        this._itemizer = new Itemizer();
    }

    get fontManager(): FontManager {
        return this._fontManager;
    }

    /**
     * Shape an entire Story into an array of ShapedParagraphs.
     * Each paragraph is ready to be fed into the Knuth-Plass composer.
     */
    shapeStory(story: Story): ShapedParagraph[] {
        const paragraphs = story.getParagraphs();
        return paragraphs.map((para) => this.shapeParagraph(
            para.text,
            para.startOffset,
            story,
        ));
    }

    /**
     * Shape a single paragraph of text.
     * 
     * Pipeline: text → itemize → shape each run → find break opportunities
     */
    shapeParagraph(
        text: string,
        startOffset: number,
        story: Story,
    ): ShapedParagraph {
        // Step 1: Find break opportunities
        const breakOpportunities = this._segmenter.findBreakOpportunities(text);

        // Step 2: Itemize into uniform runs
        const textRuns = this._itemizer.itemize(text, startOffset, story);

        // Step 3: Shape each run with HarfBuzz
        const shapedRuns = textRuns.map((run) => this._shapeRun(run, story));

        // Step 4: Assemble the ShapedParagraph
        return {
            runs: shapedRuns,
            breakOpportunities: this._adjustBreakOffsets(breakOpportunities, startOffset),
            text,
            paragraphStyle: story.getParagraphStyleAt(startOffset),
        };
    }

    /**
     * Shape a single text run using HarfBuzz, or bypass it for InlineObjects.
     */
    private _shapeRun(run: TextRun, story: Story): ShapedRun {
        if (run.isInlineObject) {
            const inlineObj = story.getInlineObjectAt(run.startOffset);
            if (!inlineObj) {
                console.warn(`[ShapingPipeline] Warning! Inline object at ${run.startOffset} is missing from Story registry!`);
                // Should never happen if data model is intact, but provide fallback
                return {
                    startOffset: run.startOffset,
                    endOffset: run.endOffset,
                    glyphs: [],
                    totalAdvance: 0,
                    style: run.style,
                };
            }

            const metrics = inlineObj.getMetrics();
            const fakeGlyph: ShapedGlyph = {
                glyphId: 0,
                // HarfBuzz clusters are relative to the text string passed to it. 
                // Since an inline object run is exactly 1 character long, its cluster is 0.
                cluster: 0,
                xAdvance: metrics.width,
                yAdvance: 0,
                xOffset: 0,
                yOffset: 0,
                isInlineObject: true,
                inlineObject: inlineObj,
            };

            return {
                startOffset: run.startOffset,
                endOffset: run.endOffset,
                glyphs: [fakeGlyph],
                totalAdvance: metrics.width,
                style: run.style,
            };
        }

        const glyphs = this._fontManager.shapeText(
            run.text,
            run.style,
            run.direction,
        );

        const totalAdvance = glyphs.reduce((sum, g) => sum + g.xAdvance, 0);

        return {
            startOffset: run.startOffset,
            endOffset: run.endOffset,
            glyphs,
            totalAdvance,
            style: run.style,
        };
    }

    /**
     * Make break opportunity offsets relative to the paragraph start.
     * The segmenter returns offsets relative to the paragraph text,
     * but we store absolute offsets for the layout engine.
     */
    private _adjustBreakOffsets(
        breaks: BreakOpportunity[],
        _startOffset: number,
    ): BreakOpportunity[] {
        // Break offsets from TextSegmenter are already relative to the paragraph text,
        // which is what the layout engine needs.
        return breaks;
    }

    /**
     * Re-shape a portion of text after a line break or hyphenation.
     * Used when a ligature spans a break point and must be decomposed.
     */
    reshapeSegment(
        text: string,
        style: CharacterStyle,
        direction: string = 'ltr',
    ): ShapedGlyph[] {
        return this._fontManager.shapeText(text, style, direction as "ltr" | "rtl" | "ttb" | "btt");
    }
}
