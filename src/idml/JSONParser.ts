/* ═══════════════════════════════════════════════════════════════
   JSONParser — Parses LSXML JSON format produced by the IDML backend

   The LSXML JSON structure mirrors IDML but in JSON form:
     LSXML.StoryXML.Story[]               — text content
     LSXML.Page_Meta.Layout.Spread[]      — page layout + frames
     LSXML.Page_Meta.Styles.Graphic.Color[] — color swatches

   Outputs the same IDMLDocument type as IDMLParser so the rest of
   the engine pipeline can be shared unchanged.
   ═══════════════════════════════════════════════════════════════ */

import type { CharacterStyle, ParagraphStyle } from '../types';
import { Table } from '../core/Table';
import type { TableConfig } from '../core/Table';

// ── Shared document types ─────────────────────────────────────────

export interface IDMLFrame {
    id: string;
    storyId: string;
    /** Page-coordinate X position (points) */
    x: number;
    /** Page-coordinate Y position (points) */
    y: number;
    width: number;
    height: number;
    nextFrameId: string | null;
    prevFrameId: string | null;
    columns: number;
    columnGap: number;
    /** Polygon vertices in page coordinates (for non-rectangular frames) */
    polygon?: Array<{ x: number; y: number }>;
}

export interface IDMLCharSpan {
    start: number;
    end: number;
    style: Partial<CharacterStyle>;
}

export interface IDMLParaSpan {
    start: number;
    end: number;
    style: Partial<ParagraphStyle>;
}

export interface IDMLStory {
    id: string;
    /** Full story text — includes U+FFFC placeholder for each inline table */
    text: string;
    charSpans: IDMLCharSpan[];
    paraSpans: IDMLParaSpan[];
    /** Tables embedded in this story, keyed by their U+FFFC placeholder offset */
    inlineObjects: Array<{ offset: number; table: Table }>;
}

/** A non-text graphic line (rule, border, dimension mark) from the spread */
export interface IDMLGraphicLine {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** CSS hex color */
    strokeColor: string;
    strokeWidth: number;
}

export interface IDMLDocument {
    /** Page width in points */
    pageWidth: number;
    /** Page height in points */
    pageHeight: number;
    /** All non-rotated text frames from spread 1 */
    frames: IDMLFrame[];
    /** Parsed stories keyed by story ID */
    stories: Record<string, IDMLStory>;
    /** The story with the most frames (likely the main body) */
    mainStoryId: string;
    /** Graphic lines / rules from the spread */
    graphicLines?: IDMLGraphicLine[];
}

// ── Utility helpers ──────────────────────────────────────────────

/** Parse a 6-value IDML affine transform string "a b c d tx ty" */
function parseTf(s: string): [number, number, number, number, number, number] {
    const v = (s ?? '1 0 0 1 0 0').trim().split(/\s+/).map(Number);
    return [v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1, v[4] ?? 0, v[5] ?? 0];
}

/** Apply affine transform to a 2-D point */
function applyTf(
    tf: [number, number, number, number, number, number],
    x: number,
    y: number,
): [number, number] {
    const [a, b, c, d, tx, ty] = tf;
    return [a * x + c * y + tx, b * x + d * y + ty];
}

/** Normalise any value that might be an object or a primitive into an array */
function toArray<T>(v: T | T[] | undefined | null): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

/** Return empty string if value is null / undefined */
function str(v: unknown): string {
    if (v == null) return '';
    return String(v);
}

/** Parse float, return undefined if empty / NaN */
function pf(v: unknown): number | undefined {
    if (v == null || v === '') return undefined;
    const n = parseFloat(String(v));
    return isNaN(n) ? undefined : n;
}

// ── Color table ──────────────────────────────────────────────────

/** Convert CMYK (0–100 each) → CSS hex */
function cmykToHex(c: number, m: number, y: number, k: number): string {
    const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
    const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
    const b = Math.round(255 * (1 - y / 100) * (1 - k / 100));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Convert RGB (0–255 each) → CSS hex */
function rgbToHex(r: number, g: number, b: number): string {
    return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
}

/**
 * Build a color ID → CSS hex map from the Graphic.Color array.
 * Pre-seeds standard IDML named colors.
 */
function buildColorMap(graphicStyles: Record<string, unknown>): Map<string, string> {
    const map = new Map<string, string>([
        ['Color/Black', '#000000'],
        ['Color/Paper', '#ffffff'],
        ['Color/Registration', '#000000'],
        ['Color/None', '#000000'],
        ['Swatch/None', '#000000'],
    ]);

    const colors = toArray(
        (graphicStyles as Record<string, unknown>)['Color'] as unknown,
    ) as Record<string, string>[];

    for (const c of colors) {
        const self = str(c['Self']);
        if (!self) continue;
        const space = str(c['Space']);
        const rawVal = str(c['ColorValue']);
        const parts = rawVal.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
        let hex: string | null = null;

        if ((space === 'CMYK' || space === '') && parts.length >= 4) {
            hex = cmykToHex(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
        } else if (space === 'RGB' && parts.length >= 3) {
            hex = rgbToHex(parts[0]!, parts[1]!, parts[2]!);
        } else if (parts.length >= 4) {
            // Default to CMYK if 4 values present
            hex = cmykToHex(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
        } else if (parts.length >= 3) {
            hex = rgbToHex(parts[0]!, parts[1]!, parts[2]!);
        }

        if (hex) map.set(self, hex);
    }

    // Also parse Tint entries (e.g., "Tint/Legend 15%")
    const tints = toArray(
        (graphicStyles as Record<string, unknown>)['Tint'] as unknown,
    ) as Record<string, string>[];
    for (const t of tints) {
        const self = str(t['Self']);
        const baseId = str(t['BaseColor']);
        const tintVal = pf(t['TintValue']) ?? 100;
        const baseHex = map.get(baseId);
        if (self && baseHex) {
            // Apply tint by blending base color with white
            const r = parseInt(baseHex.slice(1, 3), 16);
            const g = parseInt(baseHex.slice(3, 5), 16);
            const b = parseInt(baseHex.slice(5, 7), 16);
            const t = tintVal / 100;
            const tr = Math.round(r * t + 255 * (1 - t));
            const tg = Math.round(g * t + 255 * (1 - t));
            const tb = Math.round(b * t + 255 * (1 - t));
            map.set(self, rgbToHex(tr, tg, tb));
        }
    }

    return map;
}

/**
 * Resolve a color reference (e.g., "Color/Black", "Color/C=100 M=0 Y=0 K=0")
 * using the pre-built color map.  Falls back to black if unresolved.
 */
function resolveColor(ref: string, colorMap: Map<string, string>): string | undefined {
    if (!ref || ref === 'Color/None' || ref === 'Swatch/None') return undefined;
    if (colorMap.has(ref)) return colorMap.get(ref)!;

    // Try inline CMYK: "Color/C=X M=Y Y=Z K=W"
    const cmykMatch = ref.match(/C=([0-9.]+)\s+M=([0-9.]+)\s+Y=([0-9.]+)\s+K=([0-9.]+)/i);
    if (cmykMatch) {
        return cmykToHex(
            parseFloat(cmykMatch[1]!),
            parseFloat(cmykMatch[2]!),
            parseFloat(cmykMatch[3]!),
            parseFloat(cmykMatch[4]!),
        );
    }

    // Try inline RGB: "Color/R=X G=Y B=Z"
    const rgbMatch = ref.match(/R=([0-9.]+)\s+G=([0-9.]+)\s+B=([0-9.]+)/i);
    if (rgbMatch) {
        return rgbToHex(
            parseFloat(rgbMatch[1]!),
            parseFloat(rgbMatch[2]!),
            parseFloat(rgbMatch[3]!),
        );
    }

    return undefined;
}

// ── Alignment mapping ────────────────────────────────────────────

function mapAlignment(s: string): ParagraphStyle['alignment'] {
    switch (s) {
        case 'RightAlign': return 'right';
        case 'CenterAlign': return 'center';
        case 'LeftJustified':
        case 'RightJustified':
        case 'CenterJustified':
        case 'FullyJustified':
        case 'JustifyAlign': return 'justify';
        default: return 'left';
    }
}

// ── Story parser ─────────────────────────────────────────────────

/**
 * Parse a single LSXML Story object into an IDMLStory.
 *
 * Structure:
 *   Story.Paragraph_Styles[]  — one element per paragraph
 *     .Leading / .PointSize / .Alignment / ... — paragraph + char defaults
 *     .content[]               — character-level runs
 *       .text / .line_break / .Position / .PointSize / .FontStyle / ...
 */
// ── Shared paragraph buffer ───────────────────────────────────────────────────

interface ParsedParagraphBuffer {
    text: string;
    charSpans: IDMLCharSpan[];
    paraSpans: IDMLParaSpan[];
}

/**
 * Parse an array of Paragraph_Styles objects into text + span arrays.
 * Shared by both parseStory (main story) and parseTable (cell stories).
 * `textOffset` allows the caller to pre-position spans when appending
 * into an already-populated buffer.
 */
function parseParagraphsToBuffer(
    paragraphs: Record<string, unknown>[],
    colorMap: Map<string, string>,
    textOffset: number = 0,
): ParsedParagraphBuffer {
    let text = '';
    const charSpans: IDMLCharSpan[] = [];
    const paraSpans: IDMLParaSpan[] = [];

    for (const para of paragraphs) {
        const paraStart = text.length;

        // ── Paragraph style ──────────────────────────────────────
        const paraStyle: Partial<ParagraphStyle> = {};

        const alignment = str(para['Alignment'] || para['Justification']);
        if (alignment) paraStyle.alignment = mapAlignment(alignment);

        const sb = pf(para['SpaceBefore']);
        if (sb != null) paraStyle.spaceBefore = sb;

        const sa = pf(para['SpaceAfter']);
        if (sa != null) paraStyle.spaceAfter = sa;

        const fli = pf(para['FirstLineIndent']);
        if (fli != null) paraStyle.firstLineIndent = fli;

        const li = pf(para['LeftIndent']);
        if (li != null) paraStyle.leftIndent = li;

        const ri = pf(para['RightIndent']);
        if (ri != null) paraStyle.rightIndent = ri;

        paraStyle.composer = 'paragraph';

        // ── Paragraph-level char defaults ────────────────────────
        const paraFontSize = pf(para['PointSize']) ?? pf(para['Size']) ?? 9;

        // Leading: 1. absolute pt, 2. AutoLeading%, 3. ×1.2 fallback
        const paraLeadingRaw = para['Leading'];
        const paraAutoLeading = pf(para['AutoLeading']);
        let paraLeadingPt: number | null = null;
        if (paraLeadingRaw && paraLeadingRaw !== 'Auto') {
            const n = pf(paraLeadingRaw);
            if (n != null && n > 0) paraLeadingPt = n;
        }
        if (paraLeadingPt === null && paraAutoLeading != null && paraAutoLeading > 0) {
            paraLeadingPt = (paraAutoLeading / 100) * paraFontSize;
        }
        if (paraLeadingPt === null) paraLeadingPt = paraFontSize * 1.2;

        const paraTracking = pf(para['Tracking']);
        const paraFontStyle = str(para['FontStyle']).toLowerCase();
        const paraFillColor = str(para['FillColor'] || para['Color']);
        const paraPosition = str(para['Position']);
        const paraBaselineShift = pf(para['BaselineShift']);
        const paraUnderline = str(para['Underline']) === 'true';
        const paraStrikethrough = str(para['Strikethrough']) === 'true';
        const paraHorizScale = pf(para['HorizontalScale']) ?? 100;

        const baseCharStyle: Partial<CharacterStyle> = {
            fontSize: paraFontSize,
            fontWeight: paraFontStyle.includes('bold') ? 700 : 400,
            fontStyle: paraFontStyle.includes('italic') ? 'italic' : 'normal',
            ...(paraTracking != null ? { tracking: paraTracking / 1000 } : {}),
        };

        if (paraFillColor) {
            const hex = resolveColor(paraFillColor, colorMap);
            if (hex) baseCharStyle.color = hex;
        }
        if (paraBaselineShift != null) baseCharStyle.baselineShift = paraBaselineShift;
        if (paraUnderline) baseCharStyle.underline = true;
        if (paraStrikethrough) baseCharStyle.strikethrough = true;

        if (paraPosition === 'Superscript') {
            baseCharStyle.fontSize = paraFontSize * 0.583;
            baseCharStyle.baselineShift = (baseCharStyle.baselineShift ?? 0) + paraFontSize * 0.333;
        } else if (paraPosition === 'Subscript') {
            baseCharStyle.fontSize = paraFontSize * 0.583;
            baseCharStyle.baselineShift = (baseCharStyle.baselineShift ?? 0) - paraFontSize * 0.167;
        }
        if (paraHorizScale !== 100) {
            const scaleDelta = (paraHorizScale - 100) / 100;
            baseCharStyle.tracking = (baseCharStyle.tracking ?? 0) + scaleDelta * 0.5;
        }

        // ── Character-level runs ──────────────────────────────────
        const contentItems = toArray(para['content']) as Record<string, unknown>[];

        for (let itemIdx = 0; itemIdx < contentItems.length; itemIdx++) {
            const item = contentItems[itemIdx]!;
            const isLineBreak = str(item['line_break']) === 'true';
            let rawText = str(item['text']);

            // \n in the text field with line_break=false is always an LSXML export
            // artifact. Actual line/paragraph breaks come from line_break=true items.
            // Empty/separator paragraphs (all-\n content) still produce \n via end-of-para.
            if (!isLineBreak) {
                rawText = rawText.replace(/\n/g, '');
            }

            const charStart = text.length;
            text += rawText;
            if (isLineBreak) text += '\n';

            if (text.length === charStart) continue;

            const runStyle: Partial<CharacterStyle> = { ...baseCharStyle };

            const runFontSize = pf(item['PointSize']) ?? pf(item['size']);
            const effectiveFontSize = runFontSize ?? (baseCharStyle.fontSize ?? paraFontSize);
            if (runFontSize != null) runStyle.fontSize = runFontSize;

            const runLeadingRaw = item['Leading'];
            const runAutoLeading = pf(item['AutoLeading']) ?? pf(para['AutoLeading']);
            let absoluteLeadingPt: number;
            if (runLeadingRaw && runLeadingRaw !== 'Auto') {
                const n = pf(runLeadingRaw);
                absoluteLeadingPt = (n != null && n > 0) ? n : paraLeadingPt!;
            } else if (runAutoLeading != null && runAutoLeading > 0) {
                absoluteLeadingPt = (runAutoLeading / 100) * effectiveFontSize;
            } else {
                absoluteLeadingPt = paraLeadingPt!;
            }
            runStyle.leading = absoluteLeadingPt / Math.max(effectiveFontSize, 1);

            const runTracking = pf(item['Tracking']);
            if (runTracking != null) runStyle.tracking = runTracking / 1000;

            const runFontStyleStr = str(item['FontStyle']).toLowerCase();
            if (runFontStyleStr) {
                runStyle.fontWeight = runFontStyleStr.includes('bold') ? 700 : 400;
                runStyle.fontStyle = runFontStyleStr.includes('italic') ? 'italic' : 'normal';
            }

            const runColor = str(item['FillColor'] || item['Color']);
            if (runColor && runColor !== 'Color/None' && runColor !== 'Swatch/None') {
                const hex = resolveColor(runColor, colorMap);
                if (hex) runStyle.color = hex;
            }

            const ulRaw = str(item['Underline']);
            if (ulRaw === 'true') runStyle.underline = true;
            else if (ulRaw === 'false') runStyle.underline = false;

            const stRaw = str(item['Strikethrough']);
            if (stRaw === 'true') runStyle.strikethrough = true;
            else if (stRaw === 'false') runStyle.strikethrough = false;

            const runBS = pf(item['BaselineShift']);
            if (runBS != null) runStyle.baselineShift = runBS;

            const position = str(item['Position']);
            if (position === 'Superscript') {
                runStyle.fontSize = effectiveFontSize * 0.583;
                runStyle.baselineShift = (runStyle.baselineShift ?? 0) + effectiveFontSize * 0.333;
            } else if (position === 'Subscript') {
                runStyle.fontSize = effectiveFontSize * 0.583;
                runStyle.baselineShift = (runStyle.baselineShift ?? 0) - effectiveFontSize * 0.167;
            }

            const horizScale = pf(item['HorizontalScale']);
            if (horizScale != null && horizScale !== 100) {
                const scaleDelta = (horizScale - 100) / 100;
                runStyle.tracking = (runStyle.tracking ?? 0) + scaleDelta * 0.5;
            }

            const kernVal = pf(item['KerningValue']);
            if (kernVal != null && kernVal !== 0) {
                runStyle.tracking = (runStyle.tracking ?? 0) + kernVal / 1000;
            }

            charSpans.push({
                start: textOffset + charStart,
                end: textOffset + text.length,
                style: runStyle,
            });
        }

        if (contentItems.length === 0) {
            text += '\n';
        } else if (!text.endsWith('\n')) {
            text += '\n';
        }

        if (text.length > paraStart) {
            paraSpans.push({
                start: textOffset + paraStart,
                end: textOffset + text.length,
                style: paraStyle,
            });
        }
    }

    return { text, charSpans, paraSpans };
}

// ── Vertical-justify map ──────────────────────────────────────────────────────

function mapVerticalJustification(s: string): import('../types').CellStyle['verticalAlign'] {
    switch (s) {
        case 'BottomAlign': return 'bottom';
        case 'CenterAlign': return 'middle';
        case 'TopAlign':
        default: return 'top';
    }
}

// ── Table parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single LSXML table JSON object into a Table inline object.
 *
 * JSON structure:
 *   table_attrs  — HeaderRowCount, BodyRowCount, ColumnCount, TextTopInset, …
 *   column_widths — per-column widths in points
 *   row_heights   — per-row heights in points (may be shorter than actual rows)
 *   bodyrows      — flat list of cells; each cell has cell_attributes + Paragraph_Styles
 *     cell_attributes.Name — "col:row" (0-indexed)
 *     cell_attributes.RowSpan / ColumnSpan
 *     cell_attributes.TextTopInset / TextLeftInset / TextBottomInset / TextRightInset
 *     cell_attributes.VerticalJustification
 */
function parseTable(
    tableJson: Record<string, unknown>,
    colorMap: Map<string, string>,
): Table {
    const attrs = (tableJson['table_attrs'] ?? {}) as Record<string, unknown>;
    const headerRows = parseInt(str(attrs['HeaderRowCount'] ?? '0')) || 0;
    const bodyRowCount = parseInt(str(attrs['BodyRowCount'] ?? '0')) || 0;
    const colCount = parseInt(str(attrs['ColumnCount'] ?? '0')) || 0;
    const totalRows = headerRows + bodyRowCount;

    // Global cell insets (used as defaults when per-cell overrides are absent)
    const globalTopInset = pf(attrs['TextTopInset']) ?? 4;
    const globalLeftInset = pf(attrs['TextLeftInset']) ?? 4;
    const globalBottomInset = pf(attrs['TextBottomInset']) ?? 4;
    const globalRightInset = pf(attrs['TextRightInset']) ?? 4;

    const rawColWidths = toArray(tableJson['column_widths']) as number[];
    const colWidths: number[] = rawColWidths.length > 0
        ? rawColWidths.map(w => (typeof w === 'number' ? w : parseFloat(String(w)) || 0))
        : Array(colCount).fill(60);

    const tableWidth = colWidths.reduce((s, w) => s + w, 0) || colCount * 60;

    const rawRowHeights = toArray(tableJson['row_heights']) as number[];
    const rowHeights: number[] = rawRowHeights.map(h =>
        typeof h === 'number' ? h : parseFloat(String(h)) || 20,
    );

    const numRows = totalRows > 0 ? totalRows : (rowHeights.length || 1);
    const numCols = colWidths.length || colCount || 1;

    const tableConfig: TableConfig = {
        id: str(attrs['Id'] || `tbl_${Math.random().toString(36).slice(2)}`),
        rows: numRows,
        cols: numCols,
        width: tableWidth,
        columnWidths: colWidths,
        rowHeightMode: 'atLeast',
        minRowHeight: 12,
        tableStyle: {
            headerRows,
            outerStrokeColor: '#999999',
            outerStrokeWidth: 0.5,
            innerStrokeColor: '#cccccc',
            innerStrokeWidth: 0.5,
        },
    };

    const table = new Table(tableConfig);

    // Set initial row heights from IDML data
    for (let r = 0; r < Math.min(rowHeights.length, numRows); r++) {
        table.setRowHeight(r, rowHeights[r]!);
    }

    // ── Populate cells from bodyrows flat list ─────────────────────────────
    const bodyrows = toArray(tableJson['bodyrows']) as Record<string, unknown>[];
    // Track which cells need merging: collect spans first, apply after populating
    const pendingMerges: Array<{ row: number; col: number; rowSpan: number; colSpan: number }> = [];

    for (const cellJson of bodyrows) {
        const ca = (cellJson['cell_attributes'] ?? {}) as Record<string, unknown>;
        const nameStr = str(ca['Name']); // "col:row" format
        const nameParts = nameStr.split(':');
        const colIdx = parseInt(nameParts[0] ?? '0') || 0;
        const rowIdx = parseInt(nameParts[1] ?? '0') || 0;

        if (rowIdx >= numRows || colIdx >= numCols) continue;

        const rowSpan = parseInt(str(ca['RowSpan'] ?? '1')) || 1;
        const colSpan = parseInt(str(ca['ColumnSpan'] ?? '1')) || 1;

        // Cell insets
        const topInset = pf(ca['TextTopInset']) ?? pf(ca['TopInset']) ?? globalTopInset;
        const leftInset = pf(ca['TextLeftInset']) ?? pf(ca['LeftInset']) ?? globalLeftInset;
        const bottomInset = pf(ca['TextBottomInset']) ?? pf(ca['BottomInset']) ?? globalBottomInset;
        const rightInset = pf(ca['TextRightInset']) ?? pf(ca['RightInset']) ?? globalRightInset;

        const vJustStr = str(ca['VerticalJustification'] ?? 'TopAlign');
        const verticalAlign = mapVerticalJustification(vJustStr);

        // Per-cell stroke weights
        const bottomStroke = pf(ca['BottomEdgeStrokeWeight']);
        const topStroke = pf(ca['TopEdgeStrokeWeight']);
        const leftStroke = pf(ca['LeftEdgeStrokeWeight']);
        const rightStroke = pf(ca['RightEdgeStrokeWeight']);

        const cell = table.getCell(rowIdx, colIdx);
        if (!cell) continue;

        cell.style.paddingTop = topInset;
        cell.style.paddingLeft = leftInset;
        cell.style.paddingBottom = bottomInset;
        cell.style.paddingRight = rightInset;
        cell.style.verticalAlign = verticalAlign;

        if (topStroke != null || rightStroke != null || bottomStroke != null || leftStroke != null) {
            const existing = cell.style.strokeProxy;
            const defaultColor = cell.style.strokeColor ?? '#000000';
            cell.style.strokeProxy = {
                top: topStroke != null ? { color: existing?.top?.color ?? defaultColor, width: topStroke } : (existing?.top ?? null),
                right: rightStroke != null ? { color: existing?.right?.color ?? defaultColor, width: rightStroke } : (existing?.right ?? null),
                bottom: bottomStroke != null ? { color: existing?.bottom?.color ?? defaultColor, width: bottomStroke } : (existing?.bottom ?? null),
                left: leftStroke != null ? { color: existing?.left?.color ?? defaultColor, width: leftStroke } : (existing?.left ?? null),
            };
        }

        // Parse cell text content
        const cellParagraphs = toArray(cellJson['Paragraph_Styles']) as Record<string, unknown>[];
        if (cellParagraphs.length > 0) {
            const buf = parseParagraphsToBuffer(cellParagraphs, colorMap, 0);
            if (buf.text.trim().length > 0) {
                cell.story.insert(0, buf.text);
                for (const cs of buf.charSpans) {
                    if (cs.end > cs.start && Object.keys(cs.style).length > 0) {
                        cell.story.applyCharacterStyle(cs.start, cs.end, cs.style);
                    }
                }
                for (const ps of buf.paraSpans) {
                    if (ps.end > ps.start && Object.keys(ps.style).length > 0) {
                        cell.story.applyParagraphStyle(ps.start, ps.end, ps.style);
                    }
                }
            }
        }

        // Queue merges (apply after all cells are populated)
        if (rowSpan > 1 || colSpan > 1) {
            pendingMerges.push({ row: rowIdx, col: colIdx, rowSpan, colSpan });
        }
    }

    // Apply merges
    for (const m of pendingMerges) {
        table.mergeCells(m.row, m.col, m.rowSpan, m.colSpan);
    }

    return table;
}

// ── Story parser ──────────────────────────────────────────────────────────────

function parseStory(
    story: Record<string, unknown>,
    colorMap: Map<string, string>,
): IDMLStory {
    const storyId = str(story['Id']);
    let text = '';
    const charSpans: IDMLCharSpan[] = [];
    const paraSpans: IDMLParaSpan[] = [];
    const inlineObjects: IDMLStory['inlineObjects'] = [];

    const paragraphs = toArray(story['Paragraph_Styles']) as Record<string, unknown>[];

    for (const para of paragraphs) {
        const paraStart = text.length;

        // ── Paragraph style (for the para span) ───────────────────
        const paraStyle: Partial<ParagraphStyle> = {};
        const alignment = str(para['Alignment'] || para['Justification']);
        if (alignment) paraStyle.alignment = mapAlignment(alignment);
        const sb = pf(para['SpaceBefore']);
        if (sb != null) paraStyle.spaceBefore = sb;
        const sa = pf(para['SpaceAfter']);
        if (sa != null) paraStyle.spaceAfter = sa;
        const fli = pf(para['FirstLineIndent']);
        if (fli != null) paraStyle.firstLineIndent = fli;
        const li = pf(para['LeftIndent']);
        if (li != null) paraStyle.leftIndent = li;
        const ri = pf(para['RightIndent']);
        if (ri != null) paraStyle.rightIndent = ri;
        paraStyle.composer = 'paragraph';

        // ── Content items ─────────────────────────────────────────
        const contentItems = toArray(para['content']) as Record<string, unknown>[];

        // Check whether any content item is a table — if so, delegate the
        // whole paragraph to parseParagraphsToBuffer so we can also handle
        // tables inline within mixed paragraphs.
        let hasTable = false;
        for (const item of contentItems) {
            if (item['table']) { hasTable = true; break; }
        }

        if (!hasTable) {
            // Fast path: no tables — use shared buffer helper
            const buf = parseParagraphsToBuffer([para], colorMap, text.length);
            text += buf.text;
            charSpans.push(...buf.charSpans);
            // Paragraph span uses the style object we already built above
            if (buf.text.length > 0) {
                paraSpans.push({ start: paraStart, end: text.length, style: paraStyle });
            }
            continue;
        }

        // Slow path: paragraph has inline tables — process content items individually
        // so we can insert U+FFFC placeholders for each table at the right position.
        //
        // We still need all the paragraph-level char defaults.  Re-use a minimal
        // single-para buffer on a fake para stripped of content, then handle items.
        const paraFontSize = pf(para['PointSize']) ?? pf(para['Size']) ?? 9;
        const paraLeadingRaw = para['Leading'];
        const paraAutoLeading = pf(para['AutoLeading']);
        let paraLeadingPt: number | null = null;
        if (paraLeadingRaw && paraLeadingRaw !== 'Auto') {
            const n = pf(paraLeadingRaw);
            if (n != null && n > 0) paraLeadingPt = n;
        }
        if (paraLeadingPt === null && paraAutoLeading != null && paraAutoLeading > 0)
            paraLeadingPt = (paraAutoLeading / 100) * paraFontSize;
        if (paraLeadingPt === null) paraLeadingPt = paraFontSize * 1.2;

        const paraFontStyle = str(para['FontStyle']).toLowerCase();
        const paraTracking = pf(para['Tracking']);
        const paraFillColor = str(para['FillColor'] || para['Color']);
        const paraBaselineShift = pf(para['BaselineShift']);
        const paraHorizScale = pf(para['HorizontalScale']) ?? 100;

        const baseCharStyle: Partial<CharacterStyle> = {
            fontSize: paraFontSize,
            fontWeight: paraFontStyle.includes('bold') ? 700 : 400,
            fontStyle: paraFontStyle.includes('italic') ? 'italic' : 'normal',
            ...(paraTracking != null ? { tracking: paraTracking / 1000 } : {}),
        };
        if (paraFillColor) {
            const hex = resolveColor(paraFillColor, colorMap);
            if (hex) baseCharStyle.color = hex;
        }
        if (paraBaselineShift != null) baseCharStyle.baselineShift = paraBaselineShift;
        if (str(para['Underline']) === 'true') baseCharStyle.underline = true;
        if (str(para['Strikethrough']) === 'true') baseCharStyle.strikethrough = true;
        if (paraHorizScale !== 100) {
            baseCharStyle.tracking = (baseCharStyle.tracking ?? 0) + ((paraHorizScale - 100) / 100) * 0.5;
        }

        for (const item of contentItems) {
            // ── Inline table ──────────────────────────────────────
            if (item['table']) {
                const tableJson = item['table'] as Record<string, unknown>;
                try {
                    const tableObj = parseTable(tableJson, colorMap);
                    const placeholderOffset = text.length;
                    text += '\uFFFC'; // U+FFFC Object Replacement Character
                    inlineObjects.push({ offset: placeholderOffset, table: tableObj });
                    // Char span for the placeholder (inherits paragraph style)
                    charSpans.push({ start: placeholderOffset, end: text.length, style: { ...baseCharStyle } });
                } catch (e) {
                    console.warn('JSONParser: failed to parse table', e);
                }
                continue;
            }

            // ── Text run ──────────────────────────────────────────
            const rawText = str(item['text']);
            const isLineBreak = str(item['line_break']) === 'true';
            const charStart = text.length;
            text += rawText;
            if (isLineBreak) text += '\n';
            if (text.length === charStart) continue;

            const runStyle: Partial<CharacterStyle> = { ...baseCharStyle };

            const runFontSize = pf(item['PointSize']) ?? pf(item['size']);
            const effectiveFontSize = runFontSize ?? (baseCharStyle.fontSize ?? paraFontSize);
            if (runFontSize != null) runStyle.fontSize = runFontSize;

            const runLeadingRaw = item['Leading'];
            const runAutoLeading = pf(item['AutoLeading']) ?? pf(para['AutoLeading']);
            let absoluteLeadingPt: number;
            if (runLeadingRaw && runLeadingRaw !== 'Auto') {
                const n = pf(runLeadingRaw);
                absoluteLeadingPt = (n != null && n > 0) ? n : paraLeadingPt!;
            } else if (runAutoLeading != null && runAutoLeading > 0) {
                absoluteLeadingPt = (runAutoLeading / 100) * effectiveFontSize;
            } else {
                absoluteLeadingPt = paraLeadingPt!;
            }
            runStyle.leading = absoluteLeadingPt / Math.max(effectiveFontSize, 1);

            const runTracking = pf(item['Tracking']);
            if (runTracking != null) runStyle.tracking = runTracking / 1000;

            const rfs = str(item['FontStyle']).toLowerCase();
            if (rfs) {
                runStyle.fontWeight = rfs.includes('bold') ? 700 : 400;
                runStyle.fontStyle = rfs.includes('italic') ? 'italic' : 'normal';
            }

            const runColor = str(item['FillColor'] || item['Color']);
            if (runColor && runColor !== 'Color/None' && runColor !== 'Swatch/None') {
                const hex = resolveColor(runColor, colorMap);
                if (hex) runStyle.color = hex;
            }

            const ulRaw = str(item['Underline']);
            if (ulRaw === 'true') runStyle.underline = true;
            else if (ulRaw === 'false') runStyle.underline = false;

            const stRaw = str(item['Strikethrough']);
            if (stRaw === 'true') runStyle.strikethrough = true;
            else if (stRaw === 'false') runStyle.strikethrough = false;

            const runBS = pf(item['BaselineShift']);
            if (runBS != null) runStyle.baselineShift = runBS;

            const position = str(item['Position']);
            if (position === 'Superscript') {
                runStyle.fontSize = effectiveFontSize * 0.583;
                runStyle.baselineShift = (runStyle.baselineShift ?? 0) + effectiveFontSize * 0.333;
            } else if (position === 'Subscript') {
                runStyle.fontSize = effectiveFontSize * 0.583;
                runStyle.baselineShift = (runStyle.baselineShift ?? 0) - effectiveFontSize * 0.167;
            }

            const horizScale = pf(item['HorizontalScale']);
            if (horizScale != null && horizScale !== 100) {
                runStyle.tracking = (runStyle.tracking ?? 0) + ((horizScale - 100) / 100) * 0.5;
            }

            const kernVal = pf(item['KerningValue']);
            if (kernVal != null && kernVal !== 0) {
                runStyle.tracking = (runStyle.tracking ?? 0) + kernVal / 1000;
            }

            charSpans.push({ start: charStart, end: text.length, style: runStyle });
        }

        if (contentItems.length === 0) {
            text += '\n';
        } else if (!text.endsWith('\n')) {
            text += '\n';
        }

        if (text.length > paraStart) {
            paraSpans.push({ start: paraStart, end: text.length, style: paraStyle });
        }
    }

    return { id: storyId, text, charSpans, paraSpans, inlineObjects };
}

// ── Frame parser ─────────────────────────────────────────────────

/**
 * Apply a 6-value affine transform to each of the 4 corner anchor
 * points and return the axis-aligned bounding box in spread coords.
 */
function anchorsToBounds(
    anchors: Array<{ Anchor: string }>,
    tf: [number, number, number, number, number, number],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!anchors.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
        const parts = str(a['Anchor']).trim().split(/\s+/);
        const lx = parseFloat(parts[0] ?? '0');
        const ly = parseFloat(parts[1] ?? '0');
        const [sx, sy] = applyTf(tf, lx, ly);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * Check if anchor array forms an axis-aligned rectangle (4 points, 2 unique X, 2 unique Y).
 */
function isAxisAlignedRect(anchors: Array<{ Anchor: string }>): boolean {
    if (anchors.length !== 4) return false;
    const xs = new Set(anchors.map(a => Math.round(parseFloat(str(a['Anchor']).split(/\s+/)[0] ?? '0') * 100)));
    const ys = new Set(anchors.map(a => Math.round(parseFloat(str(a['Anchor']).split(/\s+/)[1] ?? '0') * 100)));
    return xs.size === 2 && ys.size === 2;
}

/**
 * Extract page-coordinate bounding box + polygon from a TextFrame or Group
 * given its local anchor points, item transform, and page translate.
 */
function extractFrameGeometry(
    anchors: Array<{ Anchor: string }>,
    frameTf: [number, number, number, number, number, number],
    pageTx: number,
    pageTy: number,
): {
    x: number; y: number; width: number; height: number;
    polygon?: Array<{ x: number; y: number }>;
} | null {
    if (!anchors.length) return null;

    const bounds = anchorsToBounds(anchors, frameTf);
    if (!bounds) return null;

    const pageX = bounds.minX - pageTx;
    const pageY = bounds.minY - pageTy;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    // Build polygon for non-rectangular frames
    let polygon: Array<{ x: number; y: number }> | undefined;
    if (!isAxisAlignedRect(anchors)) {
        polygon = anchors.map(a => {
            const parts = str(a['Anchor']).trim().split(/\s+/);
            const lx = parseFloat(parts[0] ?? '0');
            const ly = parseFloat(parts[1] ?? '0');
            const [sx, sy] = applyTf(frameTf, lx, ly);
            return { x: sx - pageTx, y: sy - pageTy };
        });
    }

    return { x: pageX, y: pageY, width, height, polygon };
}

// ── Graphic-line extractor ────────────────────────────────────────

/**
 * Extract page-coordinate graphic lines from a Group's GraphicLine children.
 */
function extractGraphicLines(
    group: Record<string, unknown>,
    pageTx: number,
    pageTy: number,
    colorMap: Map<string, string>,
): IDMLGraphicLine[] {
    const lines: IDMLGraphicLine[] = [];
    const gls = toArray(group['GraphicLine']) as Record<string, unknown>[];

    for (const gl of gls) {
        const sw = pf(gl['StrokeWeight']) ?? 0;
        if (sw <= 0) continue;

        const visible = str(gl['Visible']);
        if (visible === 'false') continue;

        const glTf = parseTf(str(gl['ItemTransform']));
        const strokeRef = str(gl['StrokeColor']);
        const strokeColor = resolveColor(strokeRef, colorMap) ?? '#000000';

        // PathGeometry.GeometryPathType.PathPointArray.PathPointType[]
        const props = (gl['Properties'] ?? {}) as Record<string, unknown>;
        const geom = (props['PathGeometry'] ?? {}) as Record<string, unknown>;
        const pathType = (geom['GeometryPathType'] ?? {}) as Record<string, unknown>;
        const ptArray = (pathType['PathPointArray'] ?? {}) as Record<string, unknown>;
        const ptList = toArray(ptArray['PathPointType']) as Record<string, string>[];

        if (ptList.length < 2) continue;

        const pts: Array<[number, number]> = ptList.map(pt => {
            const parts = str(pt['Anchor']).trim().split(/\s+/);
            const lx = parseFloat(parts[0] ?? '0');
            const ly = parseFloat(parts[1] ?? '0');
            const [sx, sy] = applyTf(glTf, lx, ly);
            return [sx - pageTx, sy - pageTy];
        });

        // Draw polyline as consecutive segments
        for (let i = 0; i < pts.length - 1; i++) {
            lines.push({
                id: `${str(gl['Id'])}_${i}`,
                x1: pts[i]![0], y1: pts[i]![1],
                x2: pts[i + 1]![0], y2: pts[i + 1]![1],
                strokeColor,
                strokeWidth: sw,
            });
        }
    }

    return lines;
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Parse an LSXML JSON document (as returned by the IDML backend) into an
 * IDMLDocument that the engine can render directly.
 *
 * @param json Parsed JSON object (LSXML root)
 */
export function parseLSXMLJson(json: unknown): IDMLDocument {
    const root = (json as Record<string, unknown>)['LSXML'] as Record<string, unknown>;
    if (!root) throw new Error('JSONParser: missing LSXML root key');

    // ── Color table ──────────────────────────────────────────────
    const pageMeta = (root['Page_Meta'] ?? {}) as Record<string, unknown>;
    const stylesNode = (pageMeta['Styles'] ?? {}) as Record<string, unknown>;
    const graphicStyles = (stylesNode['Graphic'] ?? {}) as Record<string, unknown>;
    const colorMap = buildColorMap(graphicStyles);

    // ── Spreads ──────────────────────────────────────────────────
    const layoutNode = (pageMeta['Layout'] ?? {}) as Record<string, unknown>;
    const spreads = toArray(layoutNode['Spread']) as Record<string, unknown>[];

    if (!spreads.length) throw new Error('JSONParser: no Spread found in Layout');

    const spread0 = spreads[0]!;
    const page = toArray(spread0['Page'])[0] as Record<string, unknown> | undefined;
    if (!page) throw new Error('JSONParser: no Page found in Spread');

    // Page dimensions from GeometricBounds "y1 x1 y2 x2"
    const gb = str(page['GeometricBounds']).trim().split(/\s+/).map(Number);
    const pageWidth = (gb[3] ?? 0) - (gb[1] ?? 0);
    const pageHeight = (gb[2] ?? 0) - (gb[0] ?? 0);

    // Page translate (spread → page coords)
    const pageTfArr = parseTf(str(page['ItemTransform']));
    const pageTx = pageTfArr[4];
    const pageTy = pageTfArr[5];

    // ── Walk all groups to find TextFrames + GraphicLines ────────
    const allFrames: IDMLFrame[] = [];
    const graphicLines: IDMLGraphicLine[] = [];

    const groups = toArray(spread0['Group']) as Record<string, unknown>[];
    for (const group of groups) {
        // Extract graphic lines from this group
        graphicLines.push(...extractGraphicLines(group, pageTx, pageTy, colorMap));

        // Extract text frames — TextFrame is either directly on the Group or nested
        const tfList = toArray(group['TextFrame']) as Record<string, unknown>[];
        for (const tf of tfList) {
            const storyId = str(tf['ParentStory']);
            if (!storyId) continue;

            const frameId = str(tf['Id']);
            const nextId = str(tf['NextTextFrame']);
            const prevId = str(tf['PreviousTextFrame']);

            const frameTf = parseTf(str(tf['ItemTransform']));

            // Anchor points are in Properties.PathPointType[]
            const tfProps = (tf['Properties'] ?? {}) as Record<string, unknown>;
            const anchors = toArray(tfProps['PathPointType']) as Array<{ Anchor: string }>;

            if (!anchors.length) continue;

            const geom = extractFrameGeometry(anchors, frameTf, pageTx, pageTy);
            if (!geom) continue;

            // TextFramePreference — may be on the TF itself
            const tfpNode = (tf['TextFramePreference'] ?? {}) as Record<string, unknown>;
            const columns = parseInt(str(tfpNode['TextColumnCount'] ?? '1')) || 1;

            // Resolve column gap with priority:
            //   1. TextColumnFixedWidth → derive gap from (frameWidth - cols*colWidth) / (cols-1)
            //   2. TextColumnGutter     → explicit gutter value from IDML
            //   3. Fallback             → 0 (single-column or unknown)
            const colWidth = pf(tfpNode['TextColumnFixedWidth']);
            const colGutter = pf(tfpNode['TextColumnGutter']);
            let columnGap = 0;
            if (columns > 1) {
                if (colWidth != null) {
                    columnGap = Math.max(0, (geom.width - colWidth * columns) / (columns - 1));
                } else if (colGutter != null) {
                    columnGap = colGutter;
                } else {
                    // InDesign default column gutter is 12pt (1 pica)
                    columnGap = 12;
                }
            }

            allFrames.push({
                id: frameId,
                storyId,
                x: geom.x,
                y: geom.y,
                width: geom.width,
                height: geom.height,
                columns,
                columnGap,
                nextFrameId: nextId === 'n' || !nextId ? null : nextId,
                prevFrameId: prevId === 'n' || !prevId ? null : prevId,
                polygon: geom.polygon,
            });
        }
    }

    // ── Stories ──────────────────────────────────────────────────
    const storyXml = (root['StoryXML'] ?? {}) as Record<string, unknown>;
    const storyList = toArray(storyXml['Story']) as Record<string, unknown>[];

    // Collect which story IDs appear in frames
    const storiesWithFrames = new Set(allFrames.map(f => f.storyId));

    const stories: Record<string, IDMLStory> = {};
    for (const s of storyList) {
        const id = str(s['Id']);
        if (!id) continue;
        if (!storiesWithFrames.has(id)) continue;
        const parsed = parseStory(s, colorMap);
        if (parsed.text.trim().length > 0) {
            stories[id] = parsed;
        }
    }

    // ── Main story: most linked frames ───────────────────────────
    const frameCountPerStory = new Map<string, number>();
    for (const f of allFrames) {
        frameCountPerStory.set(f.storyId, (frameCountPerStory.get(f.storyId) ?? 0) + 1);
    }
    let mainStoryId = '';
    let maxCount = 0;
    for (const [id, count] of frameCountPerStory) {
        if (count > maxCount) { maxCount = count; mainStoryId = id; }
    }

    // Fallback: pick the first story with content
    if (!mainStoryId) {
        mainStoryId = Object.keys(stories)[0] ?? '';
    }

    return { pageWidth, pageHeight, frames: allFrames, stories, mainStoryId, graphicLines };
}
