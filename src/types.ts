/* ═══════════════════════════════════════════════════════════════
   Shared Type Definitions — Rusty Text Engine
   ═══════════════════════════════════════════════════════════════ */

// ── Text Shaping ──

/** A single shaped glyph returned from HarfBuzz */
export interface ShapedGlyph {
    /** Glyph ID in the font */
    glyphId: number;
    /** Cluster index — maps back to source text offset */
    cluster: number;
    /** Horizontal advance (how far to move after this glyph) */
    xAdvance: number;
    /** Vertical advance */
    yAdvance: number;
    /** Horizontal offset from baseline cursor */
    xOffset: number;
    /** Vertical offset from baseline cursor */
    yOffset: number;
}

/** A contiguous run of shaped glyphs sharing identical style */
export interface ShapedRun {
    /** Index into the Story's text content */
    startOffset: number;
    endOffset: number;
    /** Shaped glyph output */
    glyphs: ShapedGlyph[];
    /** Total advance width of this run */
    totalAdvance: number;
    /** Style applied to this run */
    style: CharacterStyle;
}

/** A fully shaped paragraph with segmentation data */
export interface ShapedParagraph {
    runs: ShapedRun[];
    breakOpportunities: BreakOpportunity[];
    /** Source text of this paragraph */
    text: string;
    /** Paragraph-level style */
    paragraphStyle: ParagraphStyle;
}

// ── Segmentation ──

export type BreakType = 'mandatory' | 'allowed' | 'forbidden' | 'hyphen';

export interface BreakOpportunity {
    /** Text offset where break can occur */
    offset: number;
    /** Type of break opportunity */
    type: BreakType;
    /** Penalty cost for breaking here (Knuth-Plass) */
    penalty: number;
}

// ── Knuth-Plass Elements ──

export type ElementType = 'box' | 'glue' | 'penalty';

export interface BoxElement {
    type: 'box';
    /** Width of this box (glyph cluster advance) */
    width: number;
    /** Reference to the shaped glyphs this box represents */
    glyphs: Array<{ glyph: ShapedGlyph; charOffset: number; char: string }>;
    /** Source text offset range */
    startOffset: number;
    endOffset: number;
    /** Style for rendering */
    style: CharacterStyle;
    /** Micro-stretchability for hz-program (0 = rigid) */
    microStretch: number;
    /** Micro-shrinkability for hz-program (0 = rigid) */
    microShrink: number;
}

export interface GlueElement {
    type: 'glue';
    /** Natural width */
    width: number;
    /** Maximum stretch */
    stretch: number;
    /** Maximum shrink */
    shrink: number;
    /** Source text offset */
    offset: number;
}

export interface PenaltyElement {
    type: 'penalty';
    /** Penalty cost: positive discourages, negative encourages, -Infinity = forced */
    penalty: number;
    /** Width if break occurs here (e.g., hyphen width) */
    width: number;
    /** Whether this penalty is flagged (for consecutive hyphen tracking) */
    flagged: boolean;
    /** Text offset for this penalty */
    offset: number;
}

export type KnuthPlassElement = BoxElement | GlueElement | PenaltyElement;

// ── Line Breaking Results ──

export interface LineBreak {
    /** Index into the element array where this line breaks */
    breakIndex: number;
    /** Adjustment ratio for this line (-1 to ∞) */
    adjustmentRatio: number;
    /** Fitness class: 0=tight, 1=normal, 2=loose, 3=very loose */
    fitnessClass: number;
    /** Total demerits accumulated up to this break */
    totalDemerits: number;
}

export interface ComposedLine {
    /** Elements that make up this line */
    elements: KnuthPlassElement[];
    /** Adjustment ratio applied to glue */
    adjustmentRatio: number;
    /** Y position of the baseline (from frame top) */
    baselineY: number;
    /** X start position (from frame left) */
    startX: number;
    /** Actual rendered width */
    width: number;
    /** Line height (leading) */
    lineHeight: number;
    /** Source text range */
    startOffset: number;
    endOffset: number;
    /** Paragraph alignment for this line */
    alignment: TextAlignment;
    /** Whether optical margin alignment is enabled for this line's paragraph */
    opticalMargins?: boolean;
}

// ── Layout Results ──

export interface PositionedGlyph {
    glyphId: number;
    char: string;
    charOffset: number;
    x: number;
    y: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: number | string;
    fontStyle: string;
    color: string;
    /** Glyph scaling factor for hz-program (1.0 = no scaling) */
    scale: number;
    /** Actual pixel advance width of this glyph (for cursor positioning) */
    advance: number;
}

export interface ColumnLayout {
    /** Column index within the frame */
    index: number;
    /** Absolute x position */
    x: number;
    /** Absolute y position */
    y: number;
    /** Column width */
    width: number;
    /** Column height */
    height: number;
    /** Composed lines in this column */
    lines: ComposedLine[];
}

export interface FrameLayout {
    frameId: string;
    columns: ColumnLayout[];
    /** Is there overset text beyond this frame? */
    isOverset: boolean;
}

export interface LayoutResult {
    frames: FrameLayout[];
    /** All positioned glyphs for rendering (flat array) */
    glyphs: PositionedGlyph[];
    /** Total compose time in ms */
    composeTimeMs: number;
    /** Total number of lines */
    lineCount: number;
    /** Total number of glyphs positioned */
    glyphCount: number;
}

// ── Styles ──

export type TextAlignment = 'left' | 'right' | 'center' | 'justify' | 'forceJustify';
export type ComposerType = 'paragraph' | 'singleLine';

export interface ParagraphStyle {
    alignment: TextAlignment;
    /** Leading (line height) as multiplier of font size */
    leading: number;
    /** Space before paragraph in pt */
    spaceBefore: number;
    /** Space after paragraph in pt */
    spaceAfter: number;
    /** First line indent in pt */
    firstLineIndent: number;
    /** Which composer to use */
    composer: ComposerType;
    /** Enable hyphenation */
    hyphenation: boolean;
    /** Max consecutive hyphens */
    maxConsecutiveHyphens: number;
    /** Knuth-Plass tolerance (higher = accept worse breaks) */
    tolerance: number;
    /**
     * Hz-program glyph scaling config.
     * When set, glyphs are scaled horizontally within [minScale, maxScale]
     * to improve line fitting. Set to null/undefined to disable.
     */
    hzProgram?: { minScale: number; maxScale: number } | null;
    /**
     * Optical margin alignment (hanging punctuation).
     * When true, leading/trailing punctuation hangs slightly outside the column.
     */
    opticalMargins: boolean;
}

export interface CharacterStyle {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: 'normal' | 'italic';
    color: string;
    /** Tracking / letter-spacing in em units */
    tracking: number;
    /** Leading (line height) overrider as multiplier of font size */
    leading?: number;
    /** OpenType features: e.g., { liga: true, kern: true } */
    openTypeFeatures: Record<string, boolean>;
}

export const DEFAULT_PARAGRAPH_STYLE: ParagraphStyle = {
    alignment: 'left',
    leading: 1.4,
    spaceBefore: 0,
    spaceAfter: 8,
    firstLineIndent: 0,
    composer: 'paragraph',
    hyphenation: false,
    maxConsecutiveHyphens: 3,
    tolerance: 2,
    hzProgram: null, // disabled by default
    opticalMargins: false,
};

export const DEFAULT_CHARACTER_STYLE: CharacterStyle = {
    fontFamily: 'Roboto',
    fontSize: 14,
    fontWeight: 400,
    fontStyle: 'normal',
    color: '#1a1a2e',
    tracking: 0,
    leading: 1.4,
    openTypeFeatures: { liga: true, kern: true, calt: true },
};

// ── Document Model ──

/**
 * A wrap exclusion object — text flows around this polygon.
 * Page coordinates (px).
 */
export interface WrapObject {
    id: string;
    /** Absolute page coordinates of the wrap boundary polygon */
    polygon: Array<{ x: number; y: number }>;
    /** Extra clearance around the polygon (px) */
    padding: number;
    /** How text wraps: 'around' = route around, 'none' = ignore */
    wrapMode: 'around' | 'none';
}

export interface TextFrameConfig {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    columnGap: number;
    /** Optional polygon shape — if set, text flows inside this polygon
     *  instead of the AABB rect. Coordinates are in page/canvas px. */
    polygon?: Array<{ x: number; y: number }>;
    /** ID of next frame in thread (null = end of thread) */
    nextFrameId: string | null;
    /** ID of previous frame in thread (null = start of thread) */
    prevFrameId: string | null;
}

export interface EngineConfig {
    frames: TextFrameConfig[];
    defaultParagraphStyle: ParagraphStyle;
    defaultCharacterStyle: CharacterStyle;
    /** Wrap exclusion objects (text routes around these) */
    wrapObjects?: WrapObject[];
    /** Paper dimensions for display */
    paperWidth: number;
    paperHeight: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
    frames: [
        {
            id: 'frame-1',
            x: 60,
            y: 60,
            width: 480,
            height: 680,
            columns: 2,
            columnGap: 20,
            nextFrameId: null,
            prevFrameId: null,
        },
    ],
    defaultParagraphStyle: DEFAULT_PARAGRAPH_STYLE,
    defaultCharacterStyle: DEFAULT_CHARACTER_STYLE,
    paperWidth: 595,   // A4 at 72dpi
    paperHeight: 842,
};
