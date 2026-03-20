/* ═══════════════════════════════════════════════════════════════
   Table — InDesign-Quality Inline Table Object

   A Table acts as an inline object (embedded inside a parent Story)
   but independently hosts its own 2D grid of Stories via TableCells.

   Supports:
   • Per-cell CellStyle (padding, fill, stroke, vertical alignment)
   • Table-level TableStyle (header/footer rows, alternating fills, strokes)
   • Row height modes ("atLeast" / "exactly") — mirrors InDesign
   • Add/delete rows and columns
   • Per-column widths
   • Overset text detection for "exactly" height cells
   • Cell merge and split
   • Graphic cells (image/SVG placeholders)
   • First baseline control
   • Stroke proxy (selective border editing)
   • Column alternating fills
   • Keyboard navigation
   • Import/export (CSV, JSON)
   ═══════════════════════════════════════════════════════════════ */

import type {
    InlineObject,
    CellStyle,
    TableStyle,
    RowHeightMode,
    CellSpan,
    GraphicCellContent,
    TableSelection,
    TableNavigationDirection,
    TableExportFormat,
    TableData,
    PositionedGlyph,
    LayoutResult,
} from '../types';
import { DEFAULT_CELL_STYLE, DEFAULT_TABLE_STYLE } from '../types';
import { Story } from './Story';
import { FrameManager } from './TextFrame';

// ── Config ──

export interface TableConfig {
    id: string;
    rows: number;
    cols: number;
    /** Total physical width of the table */
    width: number;
    /** Optional per-column widths (must sum to `width`). Defaults to uniform. */
    columnWidths?: number[];
    /** Row height mode: 'atLeast' (dynamic) or 'exactly' (fixed). Default: 'atLeast' */
    rowHeightMode?: RowHeightMode;
    /** Minimum row height for 'atLeast' mode, or fixed height for 'exactly' mode */
    minRowHeight?: number;
    /** Table-level style overrides */
    tableStyle?: Partial<TableStyle>;
    /** Default cell style overrides */
    cellStyle?: Partial<CellStyle>;
    /** Initial merged cells */
    mergedCells?: CellSpan[];
}

// ── Preset Factories ──

export type TablePreset = 'plain' | 'striped' | 'headerStriped' | 'darkHeader' | 'columnStriped';

export function getTablePresetStyle(preset: TablePreset): Partial<TableStyle> {
    switch (preset) {
        case 'plain':
            return {};
        case 'striped':
            return {
                alternatingFills: {
                    enabled: true,
                    mode: 'rows',
                    firstColor: '#ffffff',
                    secondColor: '#f0f4f8',
                    skipFirst: 0,
                    skipLast: 0,
                },
            };
        case 'columnStriped':
            return {
                alternatingFills: {
                    enabled: true,
                    mode: 'columns',
                    firstColor: '#ffffff',
                    secondColor: '#f0f4f8',
                    skipFirst: 0,
                    skipLast: 0,
                },
            };
        case 'headerStriped':
            return {
                headerRows: 1,
                headerFillColor: '#2d3748',
                alternatingFills: {
                    enabled: true,
                    mode: 'rows',
                    firstColor: '#ffffff',
                    secondColor: '#f0f4f8',
                    skipFirst: 0,
                    skipLast: 0,
                },
            };
        case 'darkHeader':
            return {
                headerRows: 1,
                headerFillColor: '#1a202c',
                bodyFillColor: '#fafbfc',
                outerStrokeColor: '#1a202c',
                outerStrokeWidth: 2,
                innerStrokeColor: '#cbd5e0',
                innerStrokeWidth: 0.5,
            };
    }
}

// ── TableCell ──

export class TableCell {
    readonly id: string;
    readonly story: Story;
    readonly frameManager: FrameManager;

    /** Per-cell style (padding, fill, stroke, vertical align) */
    style: CellStyle;

    // Configured geometry
    width: number = 0;
    height: number = 0;

    // Cache layout computed by engine during pre-pass
    layoutResult?: LayoutResult;

    /** True if the cell content overflows its fixed height */
    isOverset: boolean = false;

    /** Merge info: if this cell is part of a merged region, reference to the span */
    mergeSpan: CellSpan | null = null;

    /** If this cell is merged away (not the anchor), set to true */
    isMergedAway: boolean = false;

    /** Graphic content for graphic cells */
    graphicContent: GraphicCellContent | null = null;

    /** Cached image element for graphic cells */
    private _cachedImage: HTMLImageElement | null = null;
    private _cachedImageSrc: string | null = null;

    constructor(id: string, cellStyle?: Partial<CellStyle>) {
        this.id = id;
        this.style = { ...DEFAULT_CELL_STYLE, ...cellStyle };
        this.story = new Story();
        this.frameManager = new FrameManager();

        // Single column text frame for the cell
        this.frameManager.addFrame({
            id: `frame_${this.id}`,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            columns: 1,
            columnGap: 0,
            nextFrameId: null,
            prevFrameId: null,
        });
    }

    /**
     * Update the internal text frame size from the cell's geometry.
     * Subtracts padding from width/height to get the usable text area.
     */
    updateFrameBox(width: number, height: number): void {
        this.width = width;
        this.height = height;
        const s = this.style;
        const frame = this.frameManager.getFrame(`frame_${this.id}`);
        if (frame) {
            frame.width = Math.max(0, width - s.paddingLeft - s.paddingRight);
            // For layout pre-pass, set height very high so we can measure natural content height.
            // The LayoutEngine will clamp later for 'exactly' mode.
            frame.height = height > 0 ? Math.max(0, height - s.paddingTop - s.paddingBottom) : 999999;
        }
    }

    /**
     * Set this cell to graphic mode with the specified content
     */
    setGraphicContent(content: GraphicCellContent): void {
        this.graphicContent = content;
        this.style.contentType = 'graphic';
        // Clear text content when switching to graphic
        if (this.story.length > 0) {
            this.story.delete(0, this.story.length);
        }
        // Invalidate cached image if source changed
        if (content.src !== this._cachedImageSrc) {
            this._cachedImage = null;
            this._cachedImageSrc = null;
        }
    }

    /**
     * Set this cell back to text mode
     */
    setTextMode(): void {
        this.graphicContent = null;
        this.style.contentType = 'text';
        this._cachedImage = null;
        this._cachedImageSrc = null;
    }

    /**
     * Load and cache the image for graphic cells
     */
    async loadImage(): Promise<HTMLImageElement | null> {
        if (this.style.contentType !== 'graphic' || !this.graphicContent?.src) {
            return null;
        }

        if (this._cachedImage && this._cachedImageSrc === this.graphicContent.src) {
            return this._cachedImage;
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this._cachedImage = img;
                this._cachedImageSrc = this.graphicContent!.src!;
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = this.graphicContent!.src!;
        });
    }

    /**
     * Get cached image (if loaded)
     */
    getCachedImage(): HTMLImageElement | null {
        return this._cachedImage;
    }

    /**
     * Calculate the first baseline offset based on the cell's style
     */
    getFirstBaselineOffset(fontSize: number, ascent: number, capHeight: number, xHeight: number): number {
        const style = this.style;
        switch (style.firstBaselineOffset) {
            case 'ascent':
                return Math.max(style.firstBaselineMin, ascent);
            case 'capHeight':
                return Math.max(style.firstBaselineMin, capHeight);
            case 'xHeight':
                return Math.max(style.firstBaselineMin, xHeight);
            case 'leading':
                return Math.max(style.firstBaselineMin, fontSize * 1.2);
            case 'fixed':
                return style.firstBaselineMin;
            default:
                return Math.max(style.firstBaselineMin, ascent);
        }
    }
}

// ── Table ──

export class Table implements InlineObject {
    readonly id: string;
    readonly type = 'table' as const;

    private _rows: number;
    private _cols: number;
    private _totalWidth: number;
    private _cells: (TableCell | null)[][];
    private _rowHeights: number[];
    private _columnWidths: number[];
    private _rowHeightMode: RowHeightMode;
    private _minRowHeight: number;
    private _tableStyle: TableStyle;
    private _defaultCellStyle: Partial<CellStyle>;
    private _mergedCells: CellSpan[] = [];
    private _selection: TableSelection;

    // Change listeners for reactivity
    private _listeners: Set<() => void> = new Set();

    constructor(config: TableConfig) {
        this.id = config.id;
        this._rows = config.rows;
        this._cols = config.cols;
        this._totalWidth = config.width;
        this._rowHeightMode = config.rowHeightMode ?? 'atLeast';
        this._minRowHeight = config.minRowHeight ?? 24;
        this._tableStyle = { ...DEFAULT_TABLE_STYLE, ...config.tableStyle };
        this._defaultCellStyle = config.cellStyle ?? {};
        this._rowHeights = new Array(this._rows).fill(this._minRowHeight);
        this._selection = { cells: [], activeCell: null, isEditing: false };

        // Per-column widths
        if (config.columnWidths && config.columnWidths.length === this._cols) {
            this._columnWidths = [...config.columnWidths];
        } else {
            this._columnWidths = new Array(this._cols).fill(this._totalWidth / this._cols);
        }

        // Initialize 2D grid
        this._cells = [];
        for (let r = 0; r < this._rows; r++) {
            const row: (TableCell | null)[] = [];
            for (let c = 0; c < this._cols; c++) {
                row.push(new TableCell(`${this.id}_R${r}C${c}`, this._defaultCellStyle));
            }
            this._cells.push(row);
        }

        // Apply initial merged cells
        if (config.mergedCells) {
            for (const span of config.mergedCells) {
                this.mergeCells(span.startRow, span.startCol, span.rowSpan, span.colSpan);
            }
        }

        this._applyColumnWidths();
    }

    // ── Accessors ──

    get rows(): number { return this._rows; }
    get cols(): number { return this._cols; }
    get tableStyle(): TableStyle { return this._tableStyle; }
    get rowHeightMode(): RowHeightMode { return this._rowHeightMode; }
    get minRowHeight(): number { return this._minRowHeight; }
    get mergedCells(): CellSpan[] { return [...this._mergedCells]; }
    get selection(): TableSelection { return this._selection; }
    get totalWidth(): number { return this._totalWidth; }

    getCell(row: number, col: number): TableCell | null {
        return this._cells[row]?.[col] ?? null;
    }

    /**
     * Get the anchor cell for a merged region (the visible cell)
     */
    getAnchorCell(row: number, col: number): TableCell | null {
        const cell = this._cells[row]?.[col];
        if (!cell) return null;
        if (cell.isMergedAway && cell.mergeSpan) {
            return this._cells[cell.mergeSpan.startRow]?.[cell.mergeSpan.startCol] ?? null;
        }
        return cell;
    }

    getRowHeight(row: number): number {
        return this._rowHeights[row] || 0;
    }

    getColumnWidth(col: number): number {
        return this._columnWidths[col] ?? (this._totalWidth / this._cols);
    }

    /**
     * Get all column widths
     */
    getColumnWidths(): number[] {
        return [...this._columnWidths];
    }

    /**
     * Get all row heights
     */
    getRowHeights(): number[] {
        return [...this._rowHeights];
    }

    // ── Setters ──

    set tableStyle(style: TableStyle) {
        this._tableStyle = style;
        this._notifyListeners();
    }

    set rowHeightMode(mode: RowHeightMode) {
        this._rowHeightMode = mode;
        this._notifyListeners();
    }

    /** Used by LayoutEngine to set the computed required height for an entire row */
    setRowHeight(row: number, height: number): void {
        if (row < 0 || row >= this._rows) return;

        if (this._rowHeightMode === 'exactly') {
            // Fixed height — keep the configured height, don't grow
            this._rowHeights[row] = this._minRowHeight;
        } else {
            // "At Least" — use max of minimum and content height
            this._rowHeights[row] = Math.max(this._minRowHeight, height);
        }

        // Update cell frames for this row
        this._updateRowCellFrames(row);
    }

    setColumnWidth(col: number, width: number): void {
        if (col < 0 || col >= this._cols) return;
        this._columnWidths[col] = width;
        // Re-total
        this._totalWidth = this._columnWidths.reduce((s, w) => s + w, 0);
        this._applyColumnWidths();
        this._notifyListeners();
    }

    /**
     * Set all column widths at once (for proportional resizing)
     */
    setColumnWidths(widths: number[]): void {
        if (widths.length !== this._cols) return;
        this._columnWidths = [...widths];
        this._totalWidth = widths.reduce((s, w) => s + w, 0);
        this._applyColumnWidths();
        this._notifyListeners();
    }

    /**
     * Distribute column widths evenly
     */
    distributeColumnsEvenly(): void {
        const evenWidth = this._totalWidth / this._cols;
        this._columnWidths = new Array(this._cols).fill(evenWidth);
        this._applyColumnWidths();
        this._notifyListeners();
    }

    /**
     * Distribute row heights evenly (for selected rows or all)
     */
    distributeRowsEvenly(startRow?: number, endRow?: number): void {
        const start = startRow ?? 0;
        const end = endRow ?? this._rows - 1;
        const totalHeight = this._rowHeights.slice(start, end + 1).reduce((s, h) => s + h, 0);
        const evenHeight = totalHeight / (end - start + 1);
        for (let r = start; r <= end; r++) {
            this._rowHeights[r] = evenHeight;
            this._updateRowCellFrames(r);
        }
        this._notifyListeners();
    }

    // ── Cell Merge/Split Operations ──

    /**
     * Merge cells in a rectangular region
     */
    mergeCells(startRow: number, startCol: number, rowSpan: number, colSpan: number): boolean {
        // Validate bounds
        if (startRow < 0 || startCol < 0 ||
            startRow + rowSpan > this._rows ||
            startCol + colSpan > this._cols ||
            rowSpan < 1 || colSpan < 1) {
            return false;
        }

        // Check if any cell in the region is already merged
        for (let r = startRow; r < startRow + rowSpan; r++) {
            for (let c = startCol; c < startCol + colSpan; c++) {
                const cell = this._cells[r]?.[c];
                if (cell?.mergeSpan && (cell.mergeSpan.startRow !== startRow || cell.mergeSpan.startCol !== startCol)) {
                    return false; // Would overlap with existing merge
                }
            }
        }

        // Create the span
        const span: CellSpan = { startRow, startCol, rowSpan, colSpan };
        this._mergedCells.push(span);

        // Get anchor cell and collect content from other cells
        const anchorCell = this._cells[startRow]![startCol]!;
        anchorCell.mergeSpan = span;
        anchorCell.isMergedAway = false;

        // Mark other cells as merged away and move their content to anchor
        for (let r = startRow; r < startRow + rowSpan; r++) {
            for (let c = startCol; c < startCol + colSpan; c++) {
                if (r === startRow && c === startCol) continue;
                const cell = this._cells[r]![c]!;

                // Append content to anchor cell
                const content = cell.story.text;
                if (content.length > 0) {
                    const anchorLen = anchorCell.story.length;
                    if (anchorLen > 0) {
                        anchorCell.story.insert(anchorLen, '\n');
                    }
                    anchorCell.story.insert(anchorCell.story.length, content);
                }

                cell.mergeSpan = span;
                cell.isMergedAway = true;
            }
        }

        this._applyColumnWidths();
        this._notifyListeners();
        return true;
    }

    /**
     * Unmerge a cell span
     */
    unmergeCells(startRow: number, startCol: number): boolean {
        const spanIdx = this._mergedCells.findIndex(
            s => s.startRow === startRow && s.startCol === startCol
        );
        if (spanIdx === -1) return false;

        const span = this._mergedCells[spanIdx]!;

        // Clear merge info from all cells in the span
        for (let r = span.startRow; r < span.startRow + span.rowSpan; r++) {
            for (let c = span.startCol; c < span.startCol + span.colSpan; c++) {
                const cell = this._cells[r]?.[c];
                if (cell) {
                    cell.mergeSpan = null;
                    cell.isMergedAway = false;
                }
            }
        }

        this._mergedCells.splice(spanIdx, 1);
        this._applyColumnWidths();
        this._notifyListeners();
        return true;
    }

    /**
     * Split a cell horizontally (add rows within the cell)
     */
    splitCellHorizontally(row: number, col: number, parts: number = 2): boolean {
        if (parts < 2) return false;
        const cell = this._cells[row]?.[col];
        if (!cell || cell.isMergedAway) return false;

        // If cell is merged, we split the merged region
        if (cell.mergeSpan) {
            // For now, don't allow splitting merged cells - must unmerge first
            return false;
        }

        // Insert additional rows
        const originalHeight = this._rowHeights[row]!;
        const newRowHeight = originalHeight / parts;

        // Insert (parts - 1) new rows after this row
        for (let i = 1; i < parts; i++) {
            this._insertRowInternal(row + i);
            this._rowHeights[row + i] = newRowHeight;
        }
        this._rowHeights[row] = newRowHeight;

        // Update all merged spans that are affected
        this._adjustMergeSpansAfterRowInsert(row, parts - 1);

        this._applyColumnWidths();
        this._notifyListeners();
        return true;
    }

    /**
     * Split a cell vertically (add columns within the cell)
     */
    splitCellVertically(row: number, col: number, parts: number = 2): boolean {
        if (parts < 2) return false;
        const cell = this._cells[row]?.[col];
        if (!cell || cell.isMergedAway) return false;

        if (cell.mergeSpan) {
            return false; // Must unmerge first
        }

        // Insert additional columns
        const originalWidth = this._columnWidths[col]!;
        const newColWidth = originalWidth / parts;

        for (let i = 1; i < parts; i++) {
            this._insertColumnInternal(col + i);
            this._columnWidths[col + i] = newColWidth;
        }
        this._columnWidths[col] = newColWidth;

        // Update all merged spans that are affected
        this._adjustMergeSpansAfterColumnInsert(col, parts - 1);

        this._applyColumnWidths();
        this._notifyListeners();
        return true;
    }

    // ── Row/Column Operations ──

    addRow(index?: number): void {
        const idx = index ?? this._rows;
        this._insertRowInternal(idx);
        this._adjustMergeSpansAfterRowInsert(idx, 1);
        this._applyColumnWidths();
        this._notifyListeners();
    }

    private _insertRowInternal(idx: number): void {
        const row: (TableCell | null)[] = [];
        for (let c = 0; c < this._cols; c++) {
            row.push(new TableCell(`${this.id}_R${this._rows}C${c}`, this._defaultCellStyle));
        }
        this._cells.splice(idx, 0, row);
        this._rowHeights.splice(idx, 0, this._minRowHeight);
        this._rows++;
    }

    deleteRow(index: number): void {
        if (this._rows <= 1 || index < 0 || index >= this._rows) return;

        // Check if any merged cell spans this row
        for (const span of this._mergedCells) {
            if (index >= span.startRow && index < span.startRow + span.rowSpan) {
                // Row is part of a merged cell - adjust or remove the span
                if (span.rowSpan === 1) {
                    this.unmergeCells(span.startRow, span.startCol);
                } else {
                    span.rowSpan--;
                    if (index === span.startRow) {
                        // Move anchor to next row
                        span.startRow++;
                    }
                }
            } else if (index < span.startRow) {
                span.startRow--;
            }
        }

        this._cells.splice(index, 1);
        this._rowHeights.splice(index, 1);
        this._rows--;
        this._applyColumnWidths();
        this._notifyListeners();
    }

    addColumn(index?: number): void {
        const idx = index ?? this._cols;
        this._insertColumnInternal(idx);
        this._adjustMergeSpansAfterColumnInsert(idx, 1);
        this._applyColumnWidths();
        this._notifyListeners();
    }

    private _insertColumnInternal(idx: number): void {
        // New column gets fair share of width
        const newColWidth = this._totalWidth / (this._cols + 1);
        // Scale existing columns to make room
        const scaleFactor = (this._totalWidth - newColWidth) / this._totalWidth;
        for (let c = 0; c < this._cols; c++) {
            this._columnWidths[c]! *= scaleFactor;
        }
        this._columnWidths.splice(idx, 0, newColWidth);
        this._cols++;

        for (let r = 0; r < this._rows; r++) {
            this._cells[r]!.splice(idx, 0, new TableCell(`${this.id}_R${r}C${this._cols}`, this._defaultCellStyle));
        }
    }

    deleteColumn(index: number): void {
        if (this._cols <= 1 || index < 0 || index >= this._cols) return;

        // Check if any merged cell spans this column
        for (const span of this._mergedCells) {
            if (index >= span.startCol && index < span.startCol + span.colSpan) {
                if (span.colSpan === 1) {
                    this.unmergeCells(span.startRow, span.startCol);
                } else {
                    span.colSpan--;
                    if (index === span.startCol) {
                        span.startCol++;
                    }
                }
            } else if (index < span.startCol) {
                span.startCol--;
            }
        }

        this._columnWidths.splice(index, 1);
        this._cols--;

        // Redistribute removed width proportionally
        const totalRemaining = this._columnWidths.reduce((s, w) => s + w, 0);
        if (totalRemaining > 0) {
            const scale = this._totalWidth / totalRemaining;
            for (let c = 0; c < this._cols; c++) {
                this._columnWidths[c]! *= scale;
            }
        }

        for (let r = 0; r < this._rows; r++) {
            this._cells[r]!.splice(index, 1);
        }
        this._applyColumnWidths();
        this._notifyListeners();
    }

    /**
     * Move a row to a new position (drag-and-drop support)
     */
    moveRow(fromIndex: number, toIndex: number): void {
        if (fromIndex < 0 || fromIndex >= this._rows || toIndex < 0 || toIndex >= this._rows) return;
        if (fromIndex === toIndex) return;

        const row = this._cells.splice(fromIndex, 1)[0]!;
        const height = this._rowHeights.splice(fromIndex, 1)[0]!;

        this._cells.splice(toIndex, 0, row);
        this._rowHeights.splice(toIndex, 0, height);

        // Update merged cell spans
        for (const span of this._mergedCells) {
            if (span.startRow === fromIndex) {
                span.startRow = toIndex;
            } else if (fromIndex < toIndex) {
                if (span.startRow > fromIndex && span.startRow <= toIndex) {
                    span.startRow--;
                }
            } else {
                if (span.startRow >= toIndex && span.startRow < fromIndex) {
                    span.startRow++;
                }
            }
        }

        this._notifyListeners();
    }

    /**
     * Move a column to a new position (drag-and-drop support)
     */
    moveColumn(fromIndex: number, toIndex: number): void {
        if (fromIndex < 0 || fromIndex >= this._cols || toIndex < 0 || toIndex >= this._cols) return;
        if (fromIndex === toIndex) return;

        const width = this._columnWidths.splice(fromIndex, 1)[0]!;
        this._columnWidths.splice(toIndex, 0, width);

        for (let r = 0; r < this._rows; r++) {
            const cell = this._cells[r]!.splice(fromIndex, 1)[0] ?? null;
            this._cells[r]!.splice(toIndex, 0, cell);
        }

        // Update merged cell spans
        for (const span of this._mergedCells) {
            if (span.startCol === fromIndex) {
                span.startCol = toIndex;
            } else if (fromIndex < toIndex) {
                if (span.startCol > fromIndex && span.startCol <= toIndex) {
                    span.startCol--;
                }
            } else {
                if (span.startCol >= toIndex && span.startCol < fromIndex) {
                    span.startCol++;
                }
            }
        }

        this._applyColumnWidths();
        this._notifyListeners();
    }

    // ── Selection & Navigation ──

    /**
     * Set the current cell selection
     */
    setSelection(selection: Partial<TableSelection>): void {
        this._selection = { ...this._selection, ...selection };
        this._notifyListeners();
    }

    /**
     * Select a single cell
     */
    selectCell(row: number, col: number): void {
        this._selection = {
            cells: [[row, col]],
            activeCell: [row, col],
            isEditing: false,
        };
        this._notifyListeners();
    }

    /**
     * Select a range of cells
     */
    selectRange(startRow: number, startCol: number, endRow: number, endCol: number): void {
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        const cells: Array<[number, number]> = [];
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                cells.push([r, c]);
            }
        }

        this._selection = {
            cells,
            activeCell: [startRow, startCol],
            isEditing: false,
        };
        this._notifyListeners();
    }

    /**
     * Select an entire row
     */
    selectRow(row: number): void {
        const cells: Array<[number, number]> = [];
        for (let c = 0; c < this._cols; c++) {
            cells.push([row, c]);
        }
        this._selection = {
            cells,
            activeCell: [row, 0],
            isEditing: false,
        };
        this._notifyListeners();
    }

    /**
     * Select an entire column
     */
    selectColumn(col: number): void {
        const cells: Array<[number, number]> = [];
        for (let r = 0; r < this._rows; r++) {
            cells.push([r, col]);
        }
        this._selection = {
            cells,
            activeCell: [0, col],
            isEditing: false,
        };
        this._notifyListeners();
    }

    /**
     * Navigate to an adjacent cell
     */
    navigate(direction: TableNavigationDirection): [number, number] | null {
        if (!this._selection.activeCell) return null;

        const [row, col] = this._selection.activeCell;
        let newRow = row;
        let newCol = col;

        switch (direction) {
            case 'up':
                newRow = Math.max(0, row - 1);
                break;
            case 'down':
                newRow = Math.min(this._rows - 1, row + 1);
                break;
            case 'left':
                newCol = Math.max(0, col - 1);
                break;
            case 'right':
                newCol = Math.min(this._cols - 1, col + 1);
                break;
            case 'tab':
                newCol = col + 1;
                if (newCol >= this._cols) {
                    newCol = 0;
                    newRow = row + 1;
                    if (newRow >= this._rows) {
                        // At end of table - optionally add a row
                        newRow = this._rows - 1;
                        newCol = this._cols - 1;
                    }
                }
                break;
            case 'shiftTab':
                newCol = col - 1;
                if (newCol < 0) {
                    newCol = this._cols - 1;
                    newRow = row - 1;
                    if (newRow < 0) {
                        newRow = 0;
                        newCol = 0;
                    }
                }
                break;
        }

        // Skip merged-away cells
        const cell = this._cells[newRow]?.[newCol];
        if (cell?.isMergedAway && cell.mergeSpan) {
            newRow = cell.mergeSpan.startRow;
            newCol = cell.mergeSpan.startCol;
        }

        this.selectCell(newRow, newCol);
        return [newRow, newCol];
    }

    /**
     * Enter edit mode for the active cell
     */
    enterEditMode(): void {
        if (this._selection.activeCell) {
            this._selection.isEditing = true;
            this._notifyListeners();
        }
    }

    /**
     * Exit edit mode
     */
    exitEditMode(): void {
        this._selection.isEditing = false;
        this._notifyListeners();
    }

    // ── Import/Export ──

    /**
     * Export table to specified format
     */
    export(format: TableExportFormat): string {
        switch (format) {
            case 'csv':
                return this._exportCSV();
            case 'json':
                return this._exportJSON();
            case 'html':
                return this._exportHTML();
        }
    }

    /**
     * Import data from CSV
     */
    static fromCSV(id: string, csv: string, width: number, options?: Partial<TableConfig>): Table {
        const rows = csv.split('\n').filter(r => r.trim());
        const data = rows.map(r => r.split(',').map(c => c.trim()));

        const numRows = data.length;
        const numCols = Math.max(...data.map(r => r.length));

        const table = new Table({
            id,
            rows: numRows,
            cols: numCols,
            width,
            ...options,
        });

        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < data[r]!.length; c++) {
                const cell = table.getCell(r, c);
                if (cell) {
                    cell.story.insert(0, data[r]![c]!);
                }
            }
        }

        return table;
    }

    /**
     * Import data from JSON
     */
    static fromJSON(id: string, json: string, width: number): Table {
        const data: TableData = JSON.parse(json);

        const table = new Table({
            id,
            rows: data.rows,
            cols: data.cols,
            width,
            columnWidths: data.columnWidths,
            tableStyle: data.tableStyle,
            mergedCells: data.mergedCells,
        });

        if (data.rowHeights) {
            for (let r = 0; r < data.rowHeights.length; r++) {
                table._rowHeights[r] = data.rowHeights[r]!;
            }
        }

        for (let r = 0; r < data.cells.length; r++) {
            for (let c = 0; c < data.cells[r]!.length; c++) {
                const cellData = data.cells[r]![c];
                const cell = table.getCell(r, c);
                if (cell && cellData) {
                    cell.story.insert(0, cellData.text);
                    if (cellData.style) {
                        cell.style = { ...cell.style, ...cellData.style };
                    }
                }
            }
        }

        return table;
    }

    private _exportCSV(): string {
        const rows: string[] = [];
        for (let r = 0; r < this._rows; r++) {
            const cells: string[] = [];
            for (let c = 0; c < this._cols; c++) {
                const cell = this._cells[r]?.[c];
                if (cell && !cell.isMergedAway) {
                    let text = cell.story.text;
                    // Escape commas and quotes
                    if (text.includes(',') || text.includes('"')) {
                        text = '"' + text.replace(/"/g, '""') + '"';
                    }
                    cells.push(text);
                } else {
                    cells.push('');
                }
            }
            rows.push(cells.join(','));
        }
        return rows.join('\n');
    }

    private _exportJSON(): string {
        const data: TableData = {
            rows: this._rows,
            cols: this._cols,
            cells: [],
            columnWidths: this._columnWidths,
            rowHeights: this._rowHeights,
            tableStyle: this._tableStyle,
            mergedCells: this._mergedCells,
        };

        for (let r = 0; r < this._rows; r++) {
            const row: Array<{ text: string; style?: Partial<CellStyle> }> = [];
            for (let c = 0; c < this._cols; c++) {
                const cell = this._cells[r]?.[c];
                if (cell) {
                    row.push({
                        text: cell.story.text,
                        style: cell.style !== DEFAULT_CELL_STYLE ? cell.style : undefined,
                    });
                } else {
                    row.push({ text: '' });
                }
            }
            data.cells.push(row);
        }

        return JSON.stringify(data, null, 2);
    }

    private _exportHTML(): string {
        let html = '<table>\n';

        for (let r = 0; r < this._rows; r++) {
            html += '  <tr>\n';
            for (let c = 0; c < this._cols; c++) {
                const cell = this._cells[r]?.[c];
                if (cell?.isMergedAway) continue;

                const span = cell?.mergeSpan;
                const rowspan = span ? ` rowspan="${span.rowSpan}"` : '';
                const colspan = span ? ` colspan="${span.colSpan}"` : '';
                const text = cell?.story.text ?? '';

                html += `    <td${rowspan}${colspan}>${this._escapeHTML(text)}</td>\n`;
            }
            html += '  </tr>\n';
        }

        html += '</table>';
        return html;
    }

    private _escapeHTML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Layout Metrics ──

    getMetrics(): { width: number; height: number; ascent: number; descent: number } {
        const totalHeight = this._rowHeights.reduce((sum, h) => sum + h, 0);
        return {
            width: this._totalWidth,
            height: totalHeight,
            ascent: totalHeight,
            descent: 0,
        };
    }

    /** Check if a specific cell has overset text (content exceeds fixed height) */
    isCellOverset(row: number, col: number): boolean {
        return this._cells[row]?.[col]?.isOverset ?? false;
    }

    /**
     * Get the actual rendered bounds of a cell (accounting for merges)
     */
    getCellBounds(row: number, col: number): { x: number; y: number; width: number; height: number } | null {
        const cell = this._cells[row]?.[col];
        if (!cell) return null;

        // If merged away, get bounds of anchor cell
        if (cell.isMergedAway && cell.mergeSpan) {
            return this.getCellBounds(cell.mergeSpan.startRow, cell.mergeSpan.startCol);
        }

        let x = 0;
        for (let c = 0; c < col; c++) {
            x += this._columnWidths[c]!;
        }

        let y = 0;
        for (let r = 0; r < row; r++) {
            y += this._rowHeights[r]!;
        }

        let width = this._columnWidths[col]!;
        let height = this._rowHeights[row]!;

        // If merged, extend bounds
        if (cell.mergeSpan) {
            for (let c = col + 1; c < col + cell.mergeSpan.colSpan; c++) {
                width += this._columnWidths[c]!;
            }
            for (let r = row + 1; r < row + cell.mergeSpan.rowSpan; r++) {
                height += this._rowHeights[r]!;
            }
        }

        return { x, y, width, height };
    }

    // ── Glyph Flattening ──

    /** Flatten all child glyphs for the renderer, applying cell padding + vertical alignment */
    *getNestedGlyphs(tableX: number, tableY: number): IterableIterator<PositionedGlyph> {
        let currentY = tableY;

        for (let r = 0; r < this._rows; r++) {
            const rowH = this._rowHeights[r] ?? this._minRowHeight;
            let colX = tableX;

            for (let c = 0; c < this._cols; c++) {
                const colW = this._columnWidths[c]!;
                const cell = this._cells[r]?.[c];

                // Skip merged-away cells - they don't render their own content
                if (cell && !cell.isMergedAway && cell.layoutResult && cell.style.contentType === 'text') {
                    const s = cell.style;
                    const bounds = this.getCellBounds(r, c);
                    const cellHeight = bounds?.height ?? rowH;

                    // Calculate content height for vertical alignment
                    let contentHeight = 0;
                    if (cell.layoutResult.glyphs.length > 0) {
                        let minY = Infinity, maxY = -Infinity;
                        for (const g of cell.layoutResult.glyphs) {
                            if (g.y - g.fontSize < minY) minY = g.y - g.fontSize;
                            if (g.y > maxY) maxY = g.y;
                        }
                        contentHeight = maxY - minY;
                    }

                    // Vertical alignment offset
                    const usableHeight = cellHeight - s.paddingTop - s.paddingBottom;
                    let vOffset = 0;
                    if (s.verticalAlign === 'middle') {
                        vOffset = Math.max(0, (usableHeight - contentHeight) / 2);
                    } else if (s.verticalAlign === 'bottom') {
                        vOffset = Math.max(0, usableHeight - contentHeight);
                    } else if (s.verticalAlign === 'justify' && contentHeight > 0) {
                        // Justify: spread lines to fill cell (handled in layout engine)
                        vOffset = 0;
                    }

                    for (const g of cell.layoutResult.glyphs) {
                        yield {
                            ...g,
                            x: g.x + colX + s.paddingLeft,
                            y: g.y + currentY + s.paddingTop + vOffset,
                            story: cell.story,
                        };
                    }
                }
                colX += colW;
            }
            currentY += rowH;
        }
    }

    // ── Rendering ──

    /** Render only background fills and graphic cells (called BEFORE text glyphs) */
    renderBackground(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        const ts = this._tableStyle;
        const headerEnd = ts.headerRows;
        const footerStart = this._rows - ts.footerRows;

        ctx.save();

        // ── Pass 1: Cell background fills ──
        let currentY = y;
        for (let r = 0; r < this._rows; r++) {
            const rowH = this._rowHeights[r]!;
            let colX = x;

            for (let c = 0; c < this._cols; c++) {
                const colW = this._columnWidths[c]!;
                const cell = this._cells[r]?.[c];

                // Skip merged-away cells for fill
                if (cell?.isMergedAway) {
                    colX += colW;
                    continue;
                }

                const bounds = this.getCellBounds(r, c);
                const fillW = bounds?.width ?? colW;
                const fillH = bounds?.height ?? rowH;

                let fillColor: string | null = null;

                // Priority: cell style > header/footer > alternating > body default
                if (cell?.style.fillColor) {
                    fillColor = cell.style.fillColor;
                } else if (r < headerEnd && ts.headerFillColor) {
                    fillColor = ts.headerFillColor;
                } else if (r >= footerStart && ts.footerRows > 0 && ts.footerFillColor) {
                    fillColor = ts.footerFillColor;
                } else if (ts.alternatingFills.enabled) {
                    if (ts.alternatingFills.mode === 'rows') {
                        // Alternating row fills apply to body rows only
                        const bodyRow = r - headerEnd;
                        const bodyRowCount = footerStart - headerEnd;
                        const skipFirst = ts.alternatingFills.skipFirst;
                        const skipLast = ts.alternatingFills.skipLast;
                        if (bodyRow >= 0 && bodyRow < bodyRowCount &&
                            bodyRow >= skipFirst && bodyRow < bodyRowCount - skipLast) {
                            const altIdx = bodyRow - skipFirst;
                            fillColor = altIdx % 2 === 0
                                ? ts.alternatingFills.firstColor
                                : ts.alternatingFills.secondColor;
                        } else if (ts.bodyFillColor) {
                            fillColor = ts.bodyFillColor;
                        }
                    } else {
                        // Column alternating
                        const skipFirst = ts.alternatingFills.skipFirst;
                        const skipLast = ts.alternatingFills.skipLast;
                        if (c >= skipFirst && c < this._cols - skipLast) {
                            const altIdx = c - skipFirst;
                            fillColor = altIdx % 2 === 0
                                ? ts.alternatingFills.firstColor
                                : ts.alternatingFills.secondColor;
                        } else if (ts.bodyFillColor) {
                            fillColor = ts.bodyFillColor;
                        }
                    }
                } else if (ts.bodyFillColor) {
                    fillColor = ts.bodyFillColor;
                }

                if (fillColor) {
                    ctx.fillStyle = fillColor;
                    ctx.fillRect(colX, currentY, fillW, fillH);
                }

                colX += colW;
            }
            currentY += rowH;
        }

        // ── Pass 2: Render graphic cells ──
        currentY = y;
        for (let r = 0; r < this._rows; r++) {
            const rowH = this._rowHeights[r]!;
            let colX = x;
            for (let c = 0; c < this._cols; c++) {
                const colW = this._columnWidths[c]!;
                const cell = this._cells[r]?.[c];

                if (cell && !cell.isMergedAway && cell.style.contentType === 'graphic') {
                    this._renderGraphicCell(ctx, cell, colX, currentY, colW, rowH);
                }
                colX += colW;
            }
            currentY += rowH;
        }

        ctx.restore();
    }

    /** Render strokes, borders, and decorations (called AFTER text glyphs) */
    renderStrokes(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        const ts = this._tableStyle;

        ctx.save();

        // ── Pass 1: Inner cell strokes ──
        // Use separate row/column stroke settings if available, fallback to inner stroke
        const rowStrokeWidth = ts.innerRowStrokeWidth ?? ts.innerStrokeWidth;
        const rowStrokeColor = ts.innerRowStrokeColor ?? ts.innerStrokeColor;
        const colStrokeWidth = ts.innerColumnStrokeWidth ?? ts.innerStrokeWidth;
        const colStrokeColor = ts.innerColumnStrokeColor ?? ts.innerStrokeColor;

        let currentY: number;

        // Horizontal inner lines
        if (rowStrokeWidth > 0) {
            ctx.strokeStyle = rowStrokeColor;
            ctx.lineWidth = rowStrokeWidth;

            currentY = y;
            for (let r = 0; r < this._rows - 1; r++) {
                currentY += this._rowHeights[r]!;

                // Check if this line is interrupted by merged cells
                let segStart = x;
                for (let c = 0; c < this._cols; c++) {
                    const cell = this._cells[r]?.[c];
                    const cellBelow = this._cells[r + 1]?.[c];

                    // If either cell spans across this line, skip drawing
                    if ((cell?.mergeSpan && cell.mergeSpan.startRow + cell.mergeSpan.rowSpan > r + 1) ||
                        (cellBelow?.isMergedAway && cellBelow.mergeSpan && cellBelow.mergeSpan.startRow <= r)) {
                        // Draw segment up to this point
                        if (segStart < x + this._getCumulativeWidth(c)) {
                            ctx.beginPath();
                            ctx.moveTo(segStart, currentY);
                            ctx.lineTo(x + this._getCumulativeWidth(c), currentY);
                            ctx.stroke();
                        }
                        segStart = x + this._getCumulativeWidth(c + 1);
                    }
                }
                // Draw remaining segment
                if (segStart < x + this._totalWidth) {
                    ctx.beginPath();
                    ctx.moveTo(segStart, currentY);
                    ctx.lineTo(x + this._totalWidth, currentY);
                    ctx.stroke();
                }
            }
        }

        // Vertical inner lines
        if (colStrokeWidth > 0) {
            ctx.strokeStyle = colStrokeColor;
            ctx.lineWidth = colStrokeWidth;

            let colX = x;
            for (let c = 0; c < this._cols - 1; c++) {
                colX += this._columnWidths[c]!;

                // Check if this line is interrupted by merged cells
                let segStart = y;
                for (let r = 0; r < this._rows; r++) {
                    const cell = this._cells[r]?.[c];
                    const cellRight = this._cells[r]?.[c + 1];

                    if ((cell?.mergeSpan && cell.mergeSpan.startCol + cell.mergeSpan.colSpan > c + 1) ||
                        (cellRight?.isMergedAway && cellRight.mergeSpan && cellRight.mergeSpan.startCol <= c)) {
                        if (segStart < y + this._getCumulativeHeight(r)) {
                            ctx.beginPath();
                            ctx.moveTo(colX, segStart);
                            ctx.lineTo(colX, y + this._getCumulativeHeight(r));
                            ctx.stroke();
                        }
                        segStart = y + this._getCumulativeHeight(r + 1);
                    }
                }
                if (segStart < y + this.getMetrics().height) {
                    ctx.beginPath();
                    ctx.moveTo(colX, segStart);
                    ctx.lineTo(colX, y + this.getMetrics().height);
                    ctx.stroke();
                }
            }
        }

        // ── Pass 4: Per-cell stroke proxy borders ──
        currentY = y;
        for (let r = 0; r < this._rows; r++) {
            const rowH = this._rowHeights[r]!;
            let colX = x;
            for (let c = 0; c < this._cols; c++) {
                const colW = this._columnWidths[c]!;
                const cell = this._cells[r]?.[c];

                if (cell?.style.strokeProxy && !cell.isMergedAway) {
                    const proxy = cell.style.strokeProxy;
                    const bounds = this.getCellBounds(r, c);
                    const bw = bounds?.width ?? colW;
                    const bh = bounds?.height ?? rowH;

                    if (proxy.top) {
                        ctx.strokeStyle = proxy.top.color;
                        ctx.lineWidth = proxy.top.width;
                        ctx.beginPath();
                        ctx.moveTo(colX, currentY);
                        ctx.lineTo(colX + bw, currentY);
                        ctx.stroke();
                    }
                    if (proxy.bottom) {
                        ctx.strokeStyle = proxy.bottom.color;
                        ctx.lineWidth = proxy.bottom.width;
                        ctx.beginPath();
                        ctx.moveTo(colX, currentY + bh);
                        ctx.lineTo(colX + bw, currentY + bh);
                        ctx.stroke();
                    }
                    if (proxy.left) {
                        ctx.strokeStyle = proxy.left.color;
                        ctx.lineWidth = proxy.left.width;
                        ctx.beginPath();
                        ctx.moveTo(colX, currentY);
                        ctx.lineTo(colX, currentY + bh);
                        ctx.stroke();
                    }
                    if (proxy.right) {
                        ctx.strokeStyle = proxy.right.color;
                        ctx.lineWidth = proxy.right.width;
                        ctx.beginPath();
                        ctx.moveTo(colX + bw, currentY);
                        ctx.lineTo(colX + bw, currentY + bh);
                        ctx.stroke();
                    }
                }
                colX += colW;
            }
            currentY += rowH;
        }

        // ── Pass 5: Outer table border ──
        if (ts.outerStrokeWidth > 0) {
            ctx.strokeStyle = ts.outerStrokeColor;
            ctx.lineWidth = ts.outerStrokeWidth;
            ctx.strokeRect(x, y, this._totalWidth, this.getMetrics().height);
        }

        // ── Pass 6: Selection highlight ──
        if (this._selection.cells.length > 0) {
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);

            for (const [sr, sc] of this._selection.cells) {
                const bounds = this.getCellBounds(sr, sc);
                if (bounds) {
                    ctx.strokeRect(x + bounds.x, y + bounds.y, bounds.width, bounds.height);
                }
            }

            // Active cell has thicker border
            if (this._selection.activeCell) {
                const [ar, ac] = this._selection.activeCell;
                const activeBounds = this.getCellBounds(ar, ac);
                if (activeBounds) {
                    ctx.lineWidth = 3;
                    ctx.strokeRect(x + activeBounds.x, y + activeBounds.y, activeBounds.width, activeBounds.height);
                }
            }
        }

        // ── Pass 7: Overset indicators (red + in corner) ──
        currentY = y;
        for (let r = 0; r < this._rows; r++) {
            const rowH = this._rowHeights[r]!;
            let colX = x;
            for (let c = 0; c < this._cols; c++) {
                const colW = this._columnWidths[c]!;
                const cell = this._cells[r]?.[c];
                if (cell?.isOverset && !cell.isMergedAway) {
                    const bounds = this.getCellBounds(r, c);
                    const bw = bounds?.width ?? colW;
                    const bh = bounds?.height ?? rowH;
                    // Draw red + icon in bottom-right corner
                    const ix = colX + bw - 10;
                    const iy = currentY + bh - 10;
                    ctx.fillStyle = '#ef4444';
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillText('+', ix, iy + 8);
                }
                colX += colW;
            }
            currentY += rowH;
        }

        ctx.restore();
    }

    /** Render the full table (backward compatibility - calls renderBackground + renderStrokes) */
    render(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        this.renderBackground(ctx, x, y);
        this.renderStrokes(ctx, x, y);
    }

    /**
     * Render a graphic cell
     */
    private _renderGraphicCell(
        ctx: CanvasRenderingContext2D,
        cell: TableCell,
        x: number,
        y: number,
        width: number,
        height: number
    ): void {
        const content = cell.graphicContent;
        if (!content) return;

        const s = cell.style;
        const innerX = x + s.paddingLeft;
        const innerY = y + s.paddingTop;
        const innerW = width - s.paddingLeft - s.paddingRight;
        const innerH = height - s.paddingTop - s.paddingBottom;

        if (content.type === 'placeholder') {
            // Draw placeholder box
            ctx.fillStyle = content.backgroundColor ?? '#e5e7eb';
            ctx.fillRect(innerX, innerY, innerW, innerH);

            // Draw X pattern
            ctx.strokeStyle = '#9ca3af';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(innerX, innerY);
            ctx.lineTo(innerX + innerW, innerY + innerH);
            ctx.moveTo(innerX + innerW, innerY);
            ctx.lineTo(innerX, innerY + innerH);
            ctx.stroke();

            // Draw border
            ctx.strokeRect(innerX, innerY, innerW, innerH);
        } else if (content.type === 'image') {
            const img = cell.getCachedImage();
            if (img) {
                this._drawImageWithFit(ctx, img, innerX, innerY, innerW, innerH, content.fitMode);
            } else {
                // Show loading placeholder
                ctx.fillStyle = '#f3f4f6';
                ctx.fillRect(innerX, innerY, innerW, innerH);
                ctx.fillStyle = '#6b7280';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Loading...', innerX + innerW / 2, innerY + innerH / 2);
            }
        } else if (content.type === 'svg' && content.svgContent) {
            // Create blob URL and render as image (simplified)
            const svgBlob = new Blob([content.svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();
            img.src = url;
            // Note: This is async - in practice you'd cache this
            img.onload = () => {
                this._drawImageWithFit(ctx, img, innerX, innerY, innerW, innerH, content.fitMode);
                URL.revokeObjectURL(url);
            };
        }
    }

    /**
     * Draw an image with the specified fit mode
     */
    private _drawImageWithFit(
        ctx: CanvasRenderingContext2D,
        img: HTMLImageElement,
        x: number,
        y: number,
        width: number,
        height: number,
        fitMode: GraphicCellContent['fitMode']
    ): void {
        const imgRatio = img.width / img.height;
        const cellRatio = width / height;

        let drawX = x, drawY = y, drawW = width, drawH = height;

        switch (fitMode) {
            case 'fill':
                // Stretch to fill
                drawX = x;
                drawY = y;
                drawW = width;
                drawH = height;
                break;
            case 'fit':
                // Fit within bounds maintaining aspect ratio
                if (imgRatio > cellRatio) {
                    drawW = width;
                    drawH = width / imgRatio;
                    drawY = y + (height - drawH) / 2;
                } else {
                    drawH = height;
                    drawW = height * imgRatio;
                    drawX = x + (width - drawW) / 2;
                }
                break;
            case 'center':
                // Center at original size (or scaled to fit if too large)
                if (img.width <= width && img.height <= height) {
                    drawW = img.width;
                    drawH = img.height;
                    drawX = x + (width - drawW) / 2;
                    drawY = y + (height - drawH) / 2;
                } else {
                    // Scale down to fit
                    if (imgRatio > cellRatio) {
                        drawW = width;
                        drawH = width / imgRatio;
                    } else {
                        drawH = height;
                        drawW = height * imgRatio;
                    }
                    drawX = x + (width - drawW) / 2;
                    drawY = y + (height - drawH) / 2;
                }
                break;
            case 'tile':
                // Tile the image
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, width, height);
                ctx.clip();
                for (let ty = y; ty < y + height; ty += img.height) {
                    for (let tx = x; tx < x + width; tx += img.width) {
                        ctx.drawImage(img, tx, ty);
                    }
                }
                ctx.restore();
                return;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    // ── Change Listeners ──

    addListener(listener: () => void): void {
        this._listeners.add(listener);
    }

    removeListener(listener: () => void): void {
        this._listeners.delete(listener);
    }

    private _notifyListeners(): void {
        for (const listener of this._listeners) {
            listener();
        }
    }

    // ── Internals ──

    private _applyColumnWidths(): void {
        for (let r = 0; r < this._rows; r++) {
            for (let c = 0; c < this._cols; c++) {
                const cell = this._cells[r]?.[c];
                if (cell && !cell.isMergedAway) {
                    const bounds = this.getCellBounds(r, c);
                    if (bounds) {
                        cell.updateFrameBox(bounds.width, bounds.height);
                    }
                }
            }
        }
    }

    private _updateRowCellFrames(row: number): void {
        for (let c = 0; c < this._cols; c++) {
            const cell = this._cells[row]?.[c];
            if (cell && !cell.isMergedAway) {
                const bounds = this.getCellBounds(row, c);
                if (bounds) {
                    cell.updateFrameBox(bounds.width, bounds.height);
                }
            }
        }
    }

    private _getCumulativeWidth(colIndex: number): number {
        let w = 0;
        for (let c = 0; c < colIndex && c < this._cols; c++) {
            w += this._columnWidths[c]!;
        }
        return w;
    }

    private _getCumulativeHeight(rowIndex: number): number {
        let h = 0;
        for (let r = 0; r < rowIndex && r < this._rows; r++) {
            h += this._rowHeights[r]!;
        }
        return h;
    }

    private _adjustMergeSpansAfterRowInsert(insertedRow: number, count: number): void {
        for (const span of this._mergedCells) {
            if (span.startRow >= insertedRow) {
                span.startRow += count;
            } else if (span.startRow + span.rowSpan > insertedRow) {
                span.rowSpan += count;
            }
        }
    }

    private _adjustMergeSpansAfterColumnInsert(insertedCol: number, count: number): void {
        for (const span of this._mergedCells) {
            if (span.startCol >= insertedCol) {
                span.startCol += count;
            } else if (span.startCol + span.colSpan > insertedCol) {
                span.colSpan += count;
            }
        }
    }
}

// ── Style Manager (for saved styles) ──

import type { SavedCellStyle, SavedTableStyle } from '../types';

export class TableStyleManager {
    private _cellStyles: Map<string, SavedCellStyle> = new Map();
    private _tableStyles: Map<string, SavedTableStyle> = new Map();

    // ── Cell Styles ──

    addCellStyle(style: SavedCellStyle): void {
        this._cellStyles.set(style.id, style);
    }

    getCellStyle(id: string): SavedCellStyle | undefined {
        return this._cellStyles.get(id);
    }

    removeCellStyle(id: string): boolean {
        return this._cellStyles.delete(id);
    }

    getAllCellStyles(): SavedCellStyle[] {
        return [...this._cellStyles.values()];
    }

    /**
     * Resolve a cell style, including inherited properties from basedOn
     */
    resolveCellStyle(id: string): Partial<CellStyle> {
        const style = this._cellStyles.get(id);
        if (!style) return {};

        if (style.basedOn) {
            const baseStyle = this.resolveCellStyle(style.basedOn);
            return { ...baseStyle, ...style.style };
        }

        return { ...style.style };
    }

    // ── Table Styles ──

    addTableStyle(style: SavedTableStyle): void {
        this._tableStyles.set(style.id, style);
    }

    getTableStyle(id: string): SavedTableStyle | undefined {
        return this._tableStyles.get(id);
    }

    removeTableStyle(id: string): boolean {
        return this._tableStyles.delete(id);
    }

    getAllTableStyles(): SavedTableStyle[] {
        return [...this._tableStyles.values()];
    }

    /**
     * Apply a saved table style to a table
     */
    applyTableStyle(table: Table, styleId: string): void {
        const savedStyle = this._tableStyles.get(styleId);
        if (!savedStyle) return;

        table.tableStyle = { ...table.tableStyle, ...savedStyle.style };

        // Apply cell styles to appropriate cells
        const ts = table.tableStyle;

        for (let r = 0; r < table.rows; r++) {
            for (let c = 0; c < table.cols; c++) {
                const cell = table.getCell(r, c);
                if (!cell) continue;

                let cellStyleId: string | undefined;

                // Determine which cell style to apply
                if (r < ts.headerRows && savedStyle.headerCellStyleId) {
                    cellStyleId = savedStyle.headerCellStyleId;
                } else if (r >= table.rows - ts.footerRows && savedStyle.footerCellStyleId) {
                    cellStyleId = savedStyle.footerCellStyleId;
                } else if (c === 0 && savedStyle.leftColumnCellStyleId) {
                    cellStyleId = savedStyle.leftColumnCellStyleId;
                } else if (c === table.cols - 1 && savedStyle.rightColumnCellStyleId) {
                    cellStyleId = savedStyle.rightColumnCellStyleId;
                } else if (savedStyle.bodyCellStyleId) {
                    cellStyleId = savedStyle.bodyCellStyleId;
                }

                if (cellStyleId) {
                    const resolved = this.resolveCellStyle(cellStyleId);
                    cell.style = { ...cell.style, ...resolved };
                }
            }
        }
    }

    // ── Serialization ──

    toJSON(): string {
        return JSON.stringify({
            cellStyles: [...this._cellStyles.values()],
            tableStyles: [...this._tableStyles.values()],
        });
    }

    static fromJSON(json: string): TableStyleManager {
        const data = JSON.parse(json);
        const manager = new TableStyleManager();

        for (const style of data.cellStyles ?? []) {
            manager.addCellStyle(style);
        }
        for (const style of data.tableStyles ?? []) {
            manager.addTableStyle(style);
        }

        return manager;
    }
}
