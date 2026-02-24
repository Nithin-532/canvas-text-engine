/* ═══════════════════════════════════════════════════════════════
   Story — The Content Model
   
   A Story is the definitive Model in the MVC architecture.
   It holds pure text content + style spans with NO awareness
   of pages, columns, frames, or screen coordinates.
   
   Multiple TextFrames can be threaded to display a single Story.
   ═══════════════════════════════════════════════════════════════ */

import {
    DEFAULT_CHARACTER_STYLE,
    DEFAULT_PARAGRAPH_STYLE,
} from '../types';
import type {
    CharacterStyle,
    ParagraphStyle,
} from '../types';

/** A span of character styling applied to a range of text */
export interface StyleSpan {
    start: number;
    end: number;
    style: Partial<CharacterStyle>;
}

/** A paragraph boundary with its associated style */
export interface ParagraphBoundary {
    /** Text offset where this paragraph starts */
    offset: number;
    style: ParagraphStyle;
}

/** Edit operation for undo/redo */
interface EditOperation {
    type: 'insert' | 'delete';
    offset: number;
    text: string;
    /** Timestamp for grouping rapid edits */
    timestamp: number;
}

type StoryChangeListener = () => void;

export class Story {
    private _text: string;
    private _styleSpans: StyleSpan[];
    private _paragraphBoundaries: ParagraphBoundary[];
    private _undoStack: EditOperation[];
    private _redoStack: EditOperation[];
    private _listeners: Set<StoryChangeListener>;
    private _defaultCharStyle: CharacterStyle;
    private _defaultParaStyle: ParagraphStyle;
    private _version: number;

    constructor(
        initialText: string = '',
        defaultCharStyle?: CharacterStyle,
        defaultParaStyle?: ParagraphStyle,
    ) {
        this._text = initialText;
        this._styleSpans = [];
        this._paragraphBoundaries = [{ offset: 0, style: defaultParaStyle ?? { ...DEFAULT_PARAGRAPH_STYLE } }];
        this._undoStack = [];
        this._redoStack = [];
        this._listeners = new Set();
        this._defaultCharStyle = defaultCharStyle ?? { ...DEFAULT_CHARACTER_STYLE };
        this._defaultParaStyle = defaultParaStyle ?? { ...DEFAULT_PARAGRAPH_STYLE };
        this._version = 0;
    }

    // ── Accessors ──

    get text(): string {
        return this._text;
    }

    get length(): number {
        return this._text.length;
    }

    get version(): number {
        return this._version;
    }

    get defaultCharacterStyle(): CharacterStyle {
        return this._defaultCharStyle;
    }

    get defaultParagraphStyle(): ParagraphStyle {
        return this._defaultParaStyle;
    }

    // ── Content Operations ──

    /** Insert text at the given offset */
    insert(offset: number, text: string): void {
        if (offset < 0 || offset > this._text.length) {
            throw new RangeError(`Insert offset ${offset} out of bounds [0, ${this._text.length}]`);
        }
        if (text.length === 0) return;

        this._text = this._text.slice(0, offset) + text + this._text.slice(offset);

        // Shift style spans
        for (const span of this._styleSpans) {
            if (span.start >= offset) {
                span.start += text.length;
                span.end += text.length;
            } else if (span.end > offset) {
                span.end += text.length;
            }
        }

        // Shift paragraph boundaries
        for (const pb of this._paragraphBoundaries) {
            if (pb.offset > offset) {
                pb.offset += text.length;
            }
        }

        // Check for new paragraph breaks in inserted text
        let searchFrom = 0;
        while (true) {
            const nlIdx = text.indexOf('\n', searchFrom);
            if (nlIdx === -1) break;
            const absOffset = offset + nlIdx + 1;
            if (absOffset < this._text.length) {
                this._paragraphBoundaries.push({
                    offset: absOffset,
                    style: { ...this._defaultParaStyle },
                });
            }
            searchFrom = nlIdx + 1;
        }
        this._paragraphBoundaries.sort((a, b) => a.offset - b.offset);

        // Record for undo
        this._undoStack.push({ type: 'insert', offset, text, timestamp: Date.now() });
        this._redoStack.length = 0;

        this._version++;
        this._notifyListeners();
    }

    /** Delete `count` characters starting at `offset` */
    delete(offset: number, count: number): void {
        if (offset < 0 || offset + count > this._text.length) {
            throw new RangeError(`Delete range [${offset}, ${offset + count}) out of bounds [0, ${this._text.length})`);
        }
        if (count === 0) return;

        const deletedText = this._text.slice(offset, offset + count);
        this._text = this._text.slice(0, offset) + this._text.slice(offset + count);

        // Adjust style spans
        this._styleSpans = this._styleSpans
            .map((span) => {
                if (span.end <= offset) return span; // Before deletion
                if (span.start >= offset + count) {
                    // After deletion — shift back
                    return { ...span, start: span.start - count, end: span.end - count };
                }
                // Overlapping — clip
                const newStart = Math.max(span.start, offset);
                const newEnd = Math.min(span.end, offset + count);
                const removedLen = newEnd - newStart;
                return {
                    ...span,
                    start: Math.min(span.start, offset),
                    end: span.end - removedLen,
                };
            })
            .filter((span) => span.end > span.start); // Remove empty spans

        // Adjust paragraph boundaries
        this._paragraphBoundaries = this._paragraphBoundaries
            .map((pb) => {
                if (pb.offset <= offset) return pb;
                if (pb.offset >= offset + count) {
                    return { ...pb, offset: pb.offset - count };
                }
                return null; // Removed by deletion
            })
            .filter((pb): pb is ParagraphBoundary => pb !== null);

        // Ensure offset 0 always has a boundary
        if (this._paragraphBoundaries.length === 0 || this._paragraphBoundaries[0]!.offset !== 0) {
            this._paragraphBoundaries.unshift({ offset: 0, style: { ...this._defaultParaStyle } });
        }

        // Record for undo
        this._undoStack.push({ type: 'delete', offset, text: deletedText, timestamp: Date.now() });
        this._redoStack.length = 0;

        this._version++;
        this._notifyListeners();
    }

    // ── Style Operations ──

    /** Apply a character style override to a range */
    applyCharacterStyle(start: number, end: number, style: Partial<CharacterStyle>): void {
        if (start >= end) return;
        this._styleSpans.push({ start, end, style });
        this._version++;
        this._notifyListeners();
    }

    /** Apply a paragraph style override to a text range */
    applyParagraphStyle(start: number, end: number, style: Partial<ParagraphStyle>): void {
        if (start >= end) return;

        let modified = false;
        // Apply the style to any paragraph boundary that falls within the range
        // A paragraph boundary affects text from its offset up to the next boundary
        for (let i = 0; i < this._paragraphBoundaries.length; i++) {
            const pb = this._paragraphBoundaries[i]!;
            const nextPbOffset = i + 1 < this._paragraphBoundaries.length ? this._paragraphBoundaries[i + 1]!.offset : this._text.length;

            // Check if this paragraph overlaps with the given range (start, end)
            if (pb.offset < end && nextPbOffset > start) {
                Object.assign(pb.style, style);
                modified = true;
            }
        }

        if (modified) {
            this._version++;
            this._notifyListeners();
        }
    }

    /** Get the resolved character style at a specific offset */
    getCharacterStyleAt(offset: number): CharacterStyle {
        const resolved = { ...this._defaultCharStyle };
        for (const span of this._styleSpans) {
            if (offset >= span.start && offset < span.end) {
                Object.assign(resolved, span.style);
            }
        }
        return resolved;
    }

    /** Get the paragraph style for a specific offset */
    getParagraphStyleAt(offset: number): ParagraphStyle {
        let result = this._defaultParaStyle;
        for (const pb of this._paragraphBoundaries) {
            if (pb.offset <= offset) {
                result = pb.style;
            } else {
                break;
            }
        }
        return result;
    }

    // ── Paragraph Utilities ──

    /** Split the full text into individual paragraphs */
    getParagraphs(): Array<{ text: string; startOffset: number; style: ParagraphStyle }> {
        const paragraphs: Array<{ text: string; startOffset: number; style: ParagraphStyle }> = [];
        const lines = this._text.split('\n');
        let offset = 0;

        for (const line of lines) {
            paragraphs.push({
                text: line,
                startOffset: offset,
                style: this.getParagraphStyleAt(offset),
            });
            offset += line.length + 1; // +1 for the \n
        }

        return paragraphs;
    }

    // ── Undo / Redo ──

    undo(): void {
        const op = this._undoStack.pop();
        if (!op) return;

        if (op.type === 'insert') {
            // Undo insert = delete
            this._text = this._text.slice(0, op.offset) + this._text.slice(op.offset + op.text.length);
        } else {
            // Undo delete = insert
            this._text = this._text.slice(0, op.offset) + op.text + this._text.slice(op.offset);
        }

        this._redoStack.push(op);
        this._version++;
        this._notifyListeners();
    }

    redo(): void {
        const op = this._redoStack.pop();
        if (!op) return;

        if (op.type === 'insert') {
            this._text = this._text.slice(0, op.offset) + op.text + this._text.slice(op.offset);
        } else {
            this._text = this._text.slice(0, op.offset) + this._text.slice(op.offset + op.text.length);
        }

        this._undoStack.push(op);
        this._version++;
        this._notifyListeners();
    }

    // ── Change Listeners ──

    addListener(listener: StoryChangeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    private _notifyListeners(): void {
        for (const listener of this._listeners) {
            listener();
        }
    }
}
