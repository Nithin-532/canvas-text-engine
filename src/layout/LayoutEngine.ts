/* ═══════════════════════════════════════════════════════════════
   LayoutEngine — Top-Level Orchestrator
   
   Coordinates the entire text layout pipeline:
   Story → Shaping → Element Building → Knuth-Plass → Column Flow
   
   This is the single entry point for the UI to request layout.
   ═══════════════════════════════════════════════════════════════ */

import type {
    LayoutResult,
    EngineConfig,
    ComposerType,
    ComposedLine,
} from '../types';
import { Story } from '../core/Story';
import { FrameManager } from '../core/TextFrame';
import { FontManager } from '../shaping/FontManager';
import { ShapingPipeline } from '../shaping/ShapingPipeline';
import { buildElements } from './KnuthPlassElements';
import { ParagraphComposer, GreedyComposer } from './ParagraphComposer';
import { ColumnFlowManager } from './ColumnFlowManager';

export interface EngineStatus {
    state: 'idle' | 'loading' | 'ready' | 'error';
    message: string;
    fontLoaded: boolean;
}

export class LayoutEngine {
    private _story: Story;
    private _fontManager: FontManager;
    private _shapingPipeline: ShapingPipeline;
    private _paragraphComposer: ParagraphComposer;
    private _greedyComposer: GreedyComposer;
    private _flowManager: ColumnFlowManager;
    private _frameManager: FrameManager;
    private _config: EngineConfig;
    private _status: EngineStatus;
    private _lastResult: LayoutResult | null = null;

    constructor(config: EngineConfig) {
        this._config = config;
        this._story = new Story('', config.defaultCharacterStyle, config.defaultParagraphStyle);
        this._fontManager = new FontManager();
        this._shapingPipeline = new ShapingPipeline(this._fontManager);
        this._paragraphComposer = new ParagraphComposer();
        this._greedyComposer = new GreedyComposer();
        this._flowManager = new ColumnFlowManager(this._fontManager);
        this._frameManager = new FrameManager();
        this._status = { state: 'idle', message: 'Not initialized', fontLoaded: false };

        // Initialize frames from config
        for (const frameConfig of config.frames) {
            this._frameManager.addFrame(frameConfig);
        }
    }

    // ── Accessors ──

    get story(): Story { return this._story; }
    get status(): EngineStatus { return this._status; }
    get config(): EngineConfig { return this._config; }
    get frameManager(): FrameManager { return this._frameManager; }
    get lastResult(): LayoutResult | null { return this._lastResult; }

    // ── Initialization ──

    /**
     * Initialize the engine: load HarfBuzz WASM + font files.
     */
    async init(fonts: { family: string; url: string; weight?: string; style?: string }[]): Promise<void> {
        try {
            this._status = { state: 'loading', message: 'Loading HarfBuzz WASM...', fontLoaded: false };

            // Initialize HarfBuzz WASM
            await this._fontManager.init();

            this._status = { state: 'loading', message: 'Loading fonts...', fontLoaded: false };

            // Load the fonts
            for (const f of fonts) {
                // Load into HarfBuzz
                await this._fontManager.loadFontFromUrl(f.family, f.url);

                // Load into Browser for Canvas 2D rendering matching
                try {
                    const fontFace = new FontFace(f.family, `url(${f.url})`, {
                        weight: f.weight ?? 'normal',
                        style: f.style ?? 'normal',
                    });
                    const loadedFace = await fontFace.load();
                    document.fonts.add(loadedFace);
                } catch (e) {
                    console.warn(`Could not load WebFont ${f.family} into DOM`, e);
                }
            }

            this._status = {
                state: 'ready',
                message: 'Ready',
                fontLoaded: true,
            };
        } catch (err) {
            this._status = {
                state: 'error',
                message: `Init failed: ${err instanceof Error ? err.message : String(err)}`,
                fontLoaded: false,
            };
            throw err;
        }
    }

    // ── Content ──

    /**
     * Set the text content of the story.
     */
    setText(text: string): void {
        this._story = new Story(text, this._config.defaultCharacterStyle, this._config.defaultParagraphStyle);
    }

    // ── Configuration ──

    /**
     * Update engine configuration and reconfigure frames.
     */
    updateConfig(partial: Partial<EngineConfig>): void {
        this._config = { ...this._config, ...partial };

        // Rebuild frames if frame config changed
        if (partial.frames) {
            this._frameManager = new FrameManager();
            for (const frameConfig of this._config.frames) {
                this._frameManager.addFrame(frameConfig);
            }
        }
    }

    /**
     * Update frame column count.
     */
    setColumns(frameId: string, columns: number): void {
        const frame = this._frameManager.getFrame(frameId);
        if (frame) {
            frame.columns = columns;
        }
    }

    // ── Layout ──

    /**
     * Run the complete layout pipeline and return positioned glyphs.
     * This is the main method called on every content or config change.
     */
    compose(): LayoutResult {
        if (this._status.state !== 'ready') {
            return {
                frames: [],
                glyphs: [],
                composeTimeMs: 0,
                lineCount: 0,
                glyphCount: 0,
            };
        }

        const startTime = performance.now();

        // Step 1: Shape the story
        const shapedParagraphs = this._shapingPipeline.shapeStory(this._story);

        // Step 2+3+4: For each paragraph, build elements, compose, and flow
        const firstFrame = this._frameManager.getFirstFrame();

        if (!firstFrame) {
            return {
                frames: [],
                glyphs: [],
                composeTimeMs: performance.now() - startTime,
                lineCount: 0,
                glyphCount: 0,
            };
        }

        // Accumulate all composed lines across all paragraphs
        let allLines: ComposedLine[] = [];

        for (const shaped of shapedParagraphs) {
            const columnWidth = firstFrame.getColumnWidth();
            const elements = buildElements(
                shaped,
                (units, size, family) => this._fontManager.fontUnitsToPixels(units, size, family),
            );

            const composerType: ComposerType = shaped.paragraphStyle.composer;
            let breaks;

            if (composerType === 'paragraph') {
                breaks = this._paragraphComposer.compose(
                    elements,
                    columnWidth,
                    shaped.paragraphStyle.tolerance,
                );
            } else {
                breaks = this._greedyComposer.compose(elements, columnWidth);
            }

            if (!breaks || breaks.length === 0) continue;

            // Build lines for this paragraph and append to total
            const lines = this._flowManager.buildComposedLines(elements, breaks, shaped.paragraphStyle);
            allLines.push(...lines);
        }

        // Distribute all lines across columns and frames in one continuous flow
        const result = this._flowManager.distribute(
            allLines,
            this._frameManager,
            firstFrame.id,
        );

        result.composeTimeMs = performance.now() - startTime;
        this._lastResult = result;
        return result;
    }

    // ── Interaction ──

    /**
     * Hit testing: map absolute (x, y) coordinates to a source text offset.
     * Returns -1 if no character is hit or if distance is too large.
     */
    hitTest(x: number, y: number): number {
        if (!this._lastResult || this._lastResult.glyphs.length === 0) return -1;

        let closestOffset = -1;
        let minDistance = Infinity;

        // Find the closest glyph
        for (const glyph of this._lastResult.glyphs) {
            // Glyph origin is at the baseline (bottom left)
            const gx = glyph.x;
            const gy = glyph.y - glyph.fontSize / 2; // Approximate center of glyph vertically

            const dx = x - gx;
            const dy = y - gy;
            const dist = dx * dx + dy * dy;

            if (dist < minDistance) {
                minDistance = dist;
                closestOffset = glyph.charOffset;

                // Cursor should go after the character if hit is on its right half
                if (dx > glyph.fontSize / 3) {
                    closestOffset = glyph.charOffset + 1;
                }
            }
        }

        if (minDistance < 10000) { // arbitrary threshold ~100px
            return closestOffset;
        }

        return -1;
    }

    // ── Cleanup ──

    destroy(): void {
        this._fontManager.destroy();
    }
}
