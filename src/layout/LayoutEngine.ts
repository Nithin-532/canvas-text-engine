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

    /** Cache for shaped paragraphs: key = paragraph text + style hash, value = shaped result */
    private _shapingCache: Map<string, import('../types').ShapedParagraph> = new Map();
    /** Story version when the shaping cache was last fully validated */
    private _lastShapingVersion: number = -1;

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
        this._shapingCache.clear();
        this._lastShapingVersion = -1;
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
        const result = this._composeInternal(this._story, this._frameManager, this._config);
        result.composeTimeMs = performance.now() - startTime;
        this._lastResult = result;
        return result;
    }

    private _composeInternal(story: Story, frameManager: FrameManager, config: EngineConfig): LayoutResult {
        // Pre-pass: layout any inline tables first so their heights are finalized
        for (const obj of story.getInlineObjects().values()) {
            if (obj.type === 'table') {
                const table = obj as import('../core/Table').Table;
                // Cell stories must NOT inherit the main story's wrap objects —
                // their frame geometry is isolated (starts at 0,0) so wrap polygons
                // from the main canvas would occlude text in cell coordinates.
                const cellConfig = { ...config, wrapObjects: [] };
                for (let r = 0; r < table.rows; r++) {
                    let maxRowHeight = 0;
                    for (let c = 0; c < table.cols; c++) {
                        const cell = table.getCell(r, c);
                        if (!cell) continue;

                        // Skip merged-away cells - they don't have their own content
                        if (cell.isMergedAway) continue;

                        // Calculate layout for this specific cell's isolated story & frame manager
                        const cellResult = this._composeInternal(cell.story, cell.frameManager, cellConfig);
                        cell.layoutResult = cellResult;

                        // Determine the physical height this cell consumed
                        let cellHeight = 0;
                        for (const frame of cellResult.frames) {
                            for (const col of frame.columns) {
                                if (col.lines.length > 0) {
                                    const lastLine = col.lines[col.lines.length - 1]!;
                                    const bottom = lastLine.baselineY + (lastLine.lineHeight * 0.3);
                                    if (bottom > cellHeight) cellHeight = bottom;
                                }
                            }
                        }
                        // Add cell padding (top + bottom)
                        const s = cell.style;
                        cellHeight += s.paddingTop + s.paddingBottom;

                        // Overset detection for 'exactly' mode
                        if (table.rowHeightMode === 'exactly') {
                            cell.isOverset = cellHeight > table.minRowHeight;
                        } else {
                            cell.isOverset = false;
                        }

                        if (cellHeight > maxRowHeight) maxRowHeight = cellHeight;
                    }
                    // Apply the maximum required height to the entire row
                    table.setRowHeight(r, maxRowHeight);
                }
            }
        }

        // Step 1: Shape the story (with paragraph-level caching)
        const paragraphs = story.getParagraphs();
        const shapedParagraphs: import('../types').ShapedParagraph[] = [];
        const storyVersion = story.version;
        const isMainStory = story === this._story;
        const newCache = isMainStory ? new Map<string, import('../types').ShapedParagraph>() : null;

        for (const para of paragraphs) {
            // A \n that immediately follows text is a paragraph terminator, not a blank line.
            // It produces a trailing empty paragraph whose startOffset equals story.length.
            // Skip it — only a \n that follows another \n (startOffset < story.length) is a
            // genuine blank line and should contribute line height.
            if (para.text === '' && para.startOffset >= story.length) continue;

            // Build a cache key from the paragraph text + its resolved style
            const paraStyle = story.getParagraphStyleAt(para.startOffset);
            const cacheKey = isMainStory
                ? `${para.startOffset}:${para.text.length}:${paraStyle.alignment}:${paraStyle.leading}:${paraStyle.composer}:${paraStyle.tolerance}:${paraStyle.spaceBefore}:${paraStyle.spaceAfter}:${paraStyle.firstLineIndent}:${paraStyle.leftIndent}:${paraStyle.rightIndent}:${storyVersion}`
                : '';

            // Check cache (only for the main story — cell stories are small enough)
            if (isMainStory && this._lastShapingVersion === storyVersion && this._shapingCache.has(cacheKey)) {
                const cached = this._shapingCache.get(cacheKey)!;
                shapedParagraphs.push(cached);
                newCache!.set(cacheKey, cached);
                continue;
            }

            const shaped = this._shapingPipeline.shapeParagraph(para.text, para.startOffset, story);
            shapedParagraphs.push(shaped);
            if (newCache) newCache.set(cacheKey, shaped);
        }

        // Swap cache
        if (isMainStory && newCache) {
            this._shapingCache = newCache;
            this._lastShapingVersion = storyVersion;
        }

        // Step 2+3+4: For each paragraph, build elements, compose, and flow
        const firstFrame = frameManager.getFirstFrame();

        if (!firstFrame) {
            return {
                frames: [],
                glyphs: [],
                composeTimeMs: 0,
                lineCount: 0,
                glyphCount: 0,
            };
        }

        // Set wrap objects BEFORE compose so buildLineWidthFn works below.
        this._flowManager.setWrapObjects(config.wrapObjects ?? []);

        // Accumulate all composed lines across all paragraphs
        const allLines: ComposedLine[] = [];

        for (const shaped of shapedParagraphs) {
            const fullColumnWidth = firstFrame.getColumnWidth();

            // Build a per-line width array that accounts for wrap exclusions and previous lines.
            // Each line number (1-based) maps to the available width at the exact
            // simulated Y position where that line will land.
            const approxLineHeight = shaped.paragraphStyle.leading *
                (shaped.runs[0]?.style.fontSize ?? config.defaultCharacterStyle.fontSize ?? 14);

            const lineWidths = this._flowManager.buildLineWidthsForParagraph(
                allLines,
                frameManager,
                firstFrame.id,
                approxLineHeight
            );

            // Fallback width: last known width from the precomputed array (avoids using a
            // potentially wrong firstFrame column width when deeper frames are narrower).
            const fallbackWidth = lineWidths[lineWidths.length - 1] ?? fullColumnWidth;
            const leftInd = shaped.paragraphStyle.leftIndent ?? 0;
            const rightInd = shaped.paragraphStyle.rightIndent ?? 0;
            const fli = shaped.paragraphStyle.firstLineIndent ?? 0;
            const lineWidthFn = (lineNumber: number) => {
                const idx = Math.max(0, lineNumber - 1);
                const base = lineWidths[idx] ?? fallbackWidth;
                const firstLineExtra = lineNumber === 1 ? fli : 0;
                return Math.max(1, base - leftInd - rightInd - firstLineExtra);
            };

            const elements = buildElements(
                shaped,
                (units, size, family) => this._fontManager.fontUnitsToPixels(units, size, family),
            );

            const composerType: ComposerType = shaped.paragraphStyle.composer;
            let breaks;

            if (composerType === 'paragraph') {
                breaks = this._paragraphComposer.compose(
                    elements,
                    lineWidthFn,
                    shaped.paragraphStyle.tolerance,
                );

                // Fallback: If Knuth-Plass fails (e.g., polygon slot is narrower than a single word),
                // use Greedy so we don't drop the paragraph entirely.
                if (!breaks || breaks.length === 0) {
                    breaks = this._greedyComposer.compose(elements, lineWidthFn);
                }
            } else {
                breaks = this._greedyComposer.compose(elements, lineWidthFn);
            }

            if (!breaks || breaks.length === 0) continue;

            // Build lines for this paragraph and append to total
            const paraFontSize = shaped.runs[0]?.style.fontSize ?? config.defaultCharacterStyle.fontSize ?? 14;
            const lines = this._flowManager.buildComposedLines(elements, breaks, shaped.paragraphStyle, paraFontSize);
            allLines.push(...lines);
        }

        // Distribute all lines across columns and frames in one continuous flow
        // (wrap objects were already set above before composing)
        const result = this._flowManager.distribute(
            allLines,
            frameManager,
            firstFrame.id,
        );

        // Flatten inline object nested glyphs into this layout result
        const nestedGlyphs: import('../types').PositionedGlyph[] = [];
        for (const g of result.glyphs) {
            g.story = story;
            if (g.isInlineObject && g.inlineObject && g.inlineObject.type === 'table') {
                const table = g.inlineObject as import('../core/Table').Table;
                const metrics = table.getMetrics();
                const tableX = g.x;
                const tableY = g.y - metrics.ascent;
                for (const childGlyph of table.getNestedGlyphs(tableX, tableY)) {
                    nestedGlyphs.push(childGlyph);
                }
            }
        }
        result.glyphs.push(...nestedGlyphs);

        return result;
    }

    // ── Interaction ──

    /**
     * Hit testing: map absolute (x, y) coordinates to a source text offset.
     * Returns null if no character is hit or if distance is too large.
     */
    hitTest(x: number, y: number): { offset: number; story: import('../core/Story').Story } | null {
        if (!this._lastResult || this._lastResult.glyphs.length === 0) return null;

        // ── Pass 1: Check if click is inside a table cell ──
        // This takes priority so that clicking inside a table always targets the cell,
        // even if a main-story glyph happens to be geometrically closer.
        for (const g of this._lastResult.glyphs) {
            if (!g.isInlineObject || !g.inlineObject || g.inlineObject.type !== 'table') continue;
            const table = g.inlineObject as import('../core/Table').Table;
            const metrics = table.getMetrics();
            const tableX = g.x;
            const tableY = g.y - metrics.ascent;

            // Check if point is within the table bounds
            if (x < tableX || x > tableX + metrics.width || y < tableY || y > tableY + metrics.height) continue;

            // Find which cell the point falls in
            let cellY = tableY;
            for (let r = 0; r < table.rows; r++) {
                const rowH = table.getRowHeight(r);
                let cellX = tableX;
                for (let c = 0; c < table.cols; c++) {
                    const colW = table.getColumnWidth(c);
                    if (x >= cellX && x <= cellX + colW && y >= cellY && y <= cellY + rowH) {
                        // Get the anchor cell (handles merged cells)
                        const cell = table.getAnchorCell(r, c);
                        if (cell) {
                            // Try to find the closest glyph within this specific cell
                            const cellGlyphs = this._lastResult!.glyphs.filter(
                                cg => cg.story === cell.story
                            );
                            if (cellGlyphs.length > 0) {
                                let bestOffset = 0;
                                let bestDist = Infinity;
                                for (const cg of cellGlyphs) {
                                    const cgx = cg.x + cg.advance / 2;
                                    const cgy = cg.y - cg.fontSize / 2;
                                    const d = (x - cgx) ** 2 + (y - cgy) ** 2;
                                    if (d < bestDist) {
                                        bestDist = d;
                                        bestOffset = cg.charOffset;
                                        if (x > cg.x + cg.advance / 2) {
                                            bestOffset = cg.charOffset + 1;
                                        }
                                    }
                                }
                                return { offset: bestOffset, story: cell.story };
                            }
                            // Empty cell — place cursor at position 0
                            return { offset: 0, story: cell.story };
                        }
                    }
                    cellX += colW;
                }
                cellY += rowH;
            }
        }

        // ── Pass 2: Closest glyph in main story ──
        let closestOffset = -1;
        let closestStory: import('../core/Story').Story | undefined = undefined;
        let minDistance = Infinity;

        for (const glyph of this._lastResult.glyphs) {
            const gx = glyph.x + glyph.advance / 2;
            const gy = glyph.y - glyph.fontSize / 2;

            const dx = x - gx;
            const dy = y - gy;
            const dist = dx * dx + dy * dy;

            if (dist < minDistance) {
                minDistance = dist;
                closestOffset = glyph.charOffset;
                closestStory = glyph.story;

                if (x > glyph.x + glyph.advance / 2) {
                    closestOffset = glyph.charOffset + 1;
                }
            }
        }

        if (minDistance < 10000) {
            return { offset: closestOffset, story: closestStory ?? this._story };
        }

        return null;
    }

    // ── Cleanup ──

    destroy(): void {
        this._fontManager.destroy();
    }
}
