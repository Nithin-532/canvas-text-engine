/* ═══════════════════════════════════════════════════════════════
   Shared Type Definitions — Rusty Text Engine
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──

export const OBJECT_REPLACEMENT_CHARACTER = '\uFFFC';

// ── Table Styles (InDesign-quality) ──

/** Row height mode — mirrors InDesign's "Exactly" / "At Least" paradigm */
export type RowHeightMode = 'atLeast' | 'exactly';

/** First baseline offset mode — mirrors InDesign's first baseline control */
export type FirstBaselineOffset = 'ascent' | 'capHeight' | 'leading' | 'xHeight' | 'fixed';

/** Cell content type — text or graphic placeholder */
export type CellContentType = 'text' | 'graphic';

/** Per-cell stroke configuration for selective border editing (stroke proxy) */
export interface CellStrokeProxy {
    top: { color: string; width: number } | null;
    right: { color: string; width: number } | null;
    bottom: { color: string; width: number } | null;
    left: { color: string; width: number } | null;
}

/** Per-cell style: padding, fill, stroke, vertical text alignment */
export interface CellStyle {
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    /** Background color (null = transparent) */
    fillColor: string | null;
    /** Border color (legacy - use strokeProxy for per-edge control) */
    strokeColor: string;
    /** Border width in px (legacy - use strokeProxy for per-edge control) */
    strokeWidth: number;
    /** Per-edge stroke configuration (null = use table-level inner/outer strokes) */
    strokeProxy: CellStrokeProxy | null;
    /** Vertical text alignment within the cell */
    verticalAlign: 'top' | 'middle' | 'bottom' | 'justify';
    /** First baseline offset mode */
    firstBaselineOffset: FirstBaselineOffset;
    /** Fixed offset value in px (used when firstBaselineOffset = 'fixed') */
    firstBaselineMin: number;
    /** Cell content type - text or graphic placeholder */
    contentType: CellContentType;
    /** Rotation angle in degrees (0, 90, 180, 270) for cell content */
    rotation: 0 | 90 | 180 | 270;
    /** Clip content to cell bounds (false = allow overflow visually) */
    clipContent: boolean;
}

/** Alternating pattern mode */
export type AlternatingMode = 'rows' | 'columns';

/** Table-level style: header/footer rows, alternating fills, outer/inner strokes */
export interface TableStyle {
    /** Number of header rows (0 = none) */
    headerRows: number;
    /** Number of footer rows (0 = none) */
    footerRows: number;
    /** Background color for header rows */
    headerFillColor: string | null;
    /** Background color for footer rows */
    footerFillColor: string | null;
    /** Default body cell background */
    bodyFillColor: string | null;
    /** Alternating fill pattern (rows or columns) */
    alternatingFills: {
        enabled: boolean;
        mode: AlternatingMode;
        firstColor: string;
        secondColor: string;
        /** Skip first N body rows/columns from alternation */
        skipFirst: number;
        /** Skip last N body rows/columns from alternation */
        skipLast: number;
    };
    /** Outer table border color */
    outerStrokeColor: string;
    /** Outer table border width */
    outerStrokeWidth: number;
    /** Inner horizontal row divider color */
    innerRowStrokeColor: string;
    /** Inner horizontal row divider width */
    innerRowStrokeWidth: number;
    /** Inner vertical column divider color */
    innerColumnStrokeColor: string;
    /** Inner vertical column divider width */
    innerColumnStrokeWidth: number;
    /** Legacy: inner stroke color (for backward compatibility) */
    innerStrokeColor: string;
    /** Legacy: inner stroke width (for backward compatibility) */
    innerStrokeWidth: number;
    /** Space before table (in parent text flow) */
    spaceBefore: number;
    /** Space after table (in parent text flow) */
    spaceAfter: number;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
    paddingTop: 4,
    paddingRight: 6,
    paddingBottom: 4,
    paddingLeft: 6,
    fillColor: null,
    strokeColor: '#cccccc',
    strokeWidth: 0.5,
    strokeProxy: null,
    verticalAlign: 'top',
    firstBaselineOffset: 'ascent',
    firstBaselineMin: 0,
    contentType: 'text',
    rotation: 0,
    clipContent: true,
};

export const DEFAULT_TABLE_STYLE: TableStyle = {
    headerRows: 0,
    footerRows: 0,
    headerFillColor: null,
    footerFillColor: null,
    bodyFillColor: null,
    alternatingFills: {
        enabled: false,
        mode: 'rows',
        firstColor: '#ffffff',
        secondColor: '#f5f5f5',
        skipFirst: 0,
        skipLast: 0,
    },
    outerStrokeColor: '#333333',
    outerStrokeWidth: 1.5,
    innerRowStrokeColor: '#cccccc',
    innerRowStrokeWidth: 0.5,
    innerColumnStrokeColor: '#cccccc',
    innerColumnStrokeWidth: 0.5,
    innerStrokeColor: '#cccccc',
    innerStrokeWidth: 0.5,
    spaceBefore: 0,
    spaceAfter: 0,
};

// ── Inline Objects ──

export interface InlineObject {
    id: string;
    type: 'table' | 'image' | 'custom';
    /** Returns the current physical dimensions of the object */
    getMetrics(): { width: number; height: number; ascent: number; descent: number };
    /** Optional render method if the object draws itself on the canvas */
    render?(ctx: CanvasRenderingContext2D, x: number, y: number): void;
}

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
    /** True if this glyph represents an inline object */
    isInlineObject?: boolean;
    /** The actual inline object reference (if applicable) */
    inlineObject?: InlineObject;
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
    /** Whether this box represents an inline object */
    isInlineObject?: boolean;
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
    /** Effective left indent for this specific line (leftIndent + firstLineIndent for line 0) */
    leftIndent?: number;
    /** Right indent for this line */
    rightIndent?: number;
    /** Space before this line's paragraph (only set on first line of paragraph) */
    spaceBefore?: number;
    /** Space after this line's paragraph (only set on last line of paragraph) */
    spaceAfter?: number;
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
    /** Underline decoration */
    underline?: boolean;
    /** Strikethrough decoration */
    strikethrough?: boolean;
    /** Indicates if this positioned element is actually an inline object */
    isInlineObject?: boolean;
    /** Reference to the actual inline object */
    inlineObject?: InlineObject;
    /** The Story this glyph belongs to (used for hit testing within nested elements) */
    story?: any; // any to avoid circular dependency in types.ts
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
    /** First line indent in pt (can be negative for hanging indent) */
    firstLineIndent: number;
    /** Left indent in pt — applies to all lines */
    leftIndent: number;
    /** Right indent in pt — applies to all lines */
    rightIndent: number;
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
    /** Leading (line height) override as multiplier of font size */
    leading?: number;
    /** Baseline shift in points — positive shifts up, negative shifts down */
    baselineShift?: number;
    /** Underline decoration */
    underline?: boolean;
    /** Strikethrough decoration */
    strikethrough?: boolean;
    /** OpenType features: e.g., { liga: true, kern: true } */
    openTypeFeatures: Record<string, boolean>;
}

export const DEFAULT_PARAGRAPH_STYLE: ParagraphStyle = {
    alignment: 'left',
    leading: 1.4,
    spaceBefore: 0,
    spaceAfter: 8,
    firstLineIndent: 0,
    leftIndent: 0,
    rightIndent: 0,
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
            width: 1080,
            height: 780,
            columns: 6,
            columnGap: 24,
            nextFrameId: null,
            prevFrameId: null,
        },
    ],
    defaultParagraphStyle: DEFAULT_PARAGRAPH_STYLE,
    defaultCharacterStyle: DEFAULT_CHARACTER_STYLE,
    paperWidth: 1200,
    paperHeight: 900,
};

// ── Table Cell Merge/Split ──

/** Represents a merged cell span */
export interface CellSpan {
    /** Starting row of the merged region */
    startRow: number;
    /** Starting column of the merged region */
    startCol: number;
    /** Number of rows in the span */
    rowSpan: number;
    /** Number of columns in the span */
    colSpan: number;
}

/** Graphic cell content for image/SVG placeholders */
export interface GraphicCellContent {
    /** Type of graphic */
    type: 'image' | 'svg' | 'placeholder';
    /** Source URL or data URI for the graphic */
    src?: string;
    /** SVG content (for inline SVG) */
    svgContent?: string;
    /** Fit mode: how the graphic fits within the cell */
    fitMode: 'fill' | 'fit' | 'center' | 'tile';
    /** Background color for placeholder or padding */
    backgroundColor?: string;
    /** Alt text for accessibility */
    altText?: string;
}

// ── Saved Styles Management ──

/** A saved cell style that can be applied to cells */
export interface SavedCellStyle {
    id: string;
    name: string;
    style: Partial<CellStyle>;
    /** Optional based-on reference for style cascading */
    basedOn?: string;
}

/** A saved table style that can be applied to tables */
export interface SavedTableStyle {
    id: string;
    name: string;
    style: Partial<TableStyle>;
    /** Cell style to apply to header rows */
    headerCellStyleId?: string;
    /** Cell style to apply to footer rows */
    footerCellStyleId?: string;
    /** Cell style to apply to body cells */
    bodyCellStyleId?: string;
    /** Cell style to apply to left column */
    leftColumnCellStyleId?: string;
    /** Cell style to apply to right column */
    rightColumnCellStyleId?: string;
}

/** Selection state for table cells */
export interface TableSelection {
    /** Currently selected cells as [row, col] pairs */
    cells: Array<[number, number]>;
    /** Active cell (for keyboard navigation) */
    activeCell: [number, number] | null;
    /** Whether we're in text editing mode within a cell */
    isEditing: boolean;
    /** Text selection within the active cell (if editing) */
    textSelection?: { start: number; end: number };
}

/** Keyboard navigation direction */
export type TableNavigationDirection = 'up' | 'down' | 'left' | 'right' | 'tab' | 'shiftTab';

/** Import/export format for tables */
export type TableExportFormat = 'csv' | 'json' | 'html';

/** Table data structure for import/export */
export interface TableData {
    rows: number;
    cols: number;
    cells: Array<Array<{
        text: string;
        style?: Partial<CellStyle>;
    }>>;
    columnWidths?: number[];
    rowHeights?: number[];
    tableStyle?: Partial<TableStyle>;
    mergedCells?: CellSpan[];
}
