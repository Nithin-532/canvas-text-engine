/* ═══════════════════════════════════════════════════════════════
   TextFrame — Geometric Viewport into a Story
   
   A TextFrame is a physical bounding region where text renders.
   Multiple TextFrames can be linked (threaded) to form a 
   continuous flow path for a single Story.
   
   TextFrames know about geometry but NOT about content.
   ═══════════════════════════════════════════════════════════════ */

import type { TextFrameConfig } from '../types';

export class TextFrame {
    readonly id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    columnGap: number;

    /** Linked-list threading: next frame in the flow */
    nextFrameId: string | null;
    /** Linked-list threading: previous frame in the flow */
    prevFrameId: string | null;

    /** Does this frame have overset text? */
    isOverset: boolean = false;

    /** The text offset in the Story where this frame's content starts */
    contentStartOffset: number = 0;
    /** The text offset in the Story where this frame's content ends */
    contentEndOffset: number = 0;

    constructor(config: TextFrameConfig) {
        this.id = config.id;
        this.x = config.x;
        this.y = config.y;
        this.width = config.width;
        this.height = config.height;
        this.columns = config.columns;
        this.columnGap = config.columnGap;
        this.nextFrameId = config.nextFrameId;
        this.prevFrameId = config.prevFrameId;
    }

    /**
     * Calculate the geometry of individual columns within this frame.
     * Returns column x, y, width, height for each column.
     */
    getColumnGeometries(): Array<{ x: number; y: number; width: number; height: number }> {
        const totalGapWidth = (this.columns - 1) * this.columnGap;
        const columnWidth = (this.width - totalGapWidth) / this.columns;
        const geometries: Array<{ x: number; y: number; width: number; height: number }> = [];

        for (let i = 0; i < this.columns; i++) {
            geometries.push({
                x: this.x + i * (columnWidth + this.columnGap),
                y: this.y,
                width: columnWidth,
                height: this.height,
            });
        }

        return geometries;
    }

    /** Get the usable inner width for a single column */
    getColumnWidth(): number {
        const totalGapWidth = (this.columns - 1) * this.columnGap;
        return (this.width - totalGapWidth) / this.columns;
    }

    /** Check if a point is inside this frame */
    containsPoint(px: number, py: number): boolean {
        return px >= this.x && px <= this.x + this.width
            && py >= this.y && py <= this.y + this.height;
    }

    /** Check if a point is inside a specific column */
    getColumnAtPoint(px: number, py: number): number | null {
        const cols = this.getColumnGeometries();
        for (let i = 0; i < cols.length; i++) {
            const col = cols[i]!;
            if (px >= col.x && px <= col.x + col.width
                && py >= col.y && py <= col.y + col.height) {
                return i;
            }
        }
        return null;
    }

    /** Export as config for serialization */
    toConfig(): TextFrameConfig {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            columns: this.columns,
            columnGap: this.columnGap,
            nextFrameId: this.nextFrameId,
            prevFrameId: this.prevFrameId,
        };
    }
}

/**
 * Manages a collection of TextFrames forming one or more threads.
 * A thread is a linked list of frames that share a single Story's text flow.
 */
export class FrameManager {
    private _frames: Map<string, TextFrame> = new Map();

    addFrame(config: TextFrameConfig): TextFrame {
        const frame = new TextFrame(config);
        this._frames.set(frame.id, frame);
        return frame;
    }

    getFrame(id: string): TextFrame | undefined {
        return this._frames.get(id);
    }

    removeFrame(id: string): void {
        const frame = this._frames.get(id);
        if (!frame) return;

        // Unlink from thread
        if (frame.prevFrameId) {
            const prev = this._frames.get(frame.prevFrameId);
            if (prev) prev.nextFrameId = frame.nextFrameId;
        }
        if (frame.nextFrameId) {
            const next = this._frames.get(frame.nextFrameId);
            if (next) next.prevFrameId = frame.prevFrameId;
        }

        this._frames.delete(id);
    }

    /** Get all frames in thread order, starting from the first frame */
    getThread(startFrameId: string): TextFrame[] {
        const thread: TextFrame[] = [];
        let currentId: string | null = startFrameId;

        // Walk back to find the head of the thread
        let head = this._frames.get(currentId);
        while (head?.prevFrameId) {
            const prev = this._frames.get(head.prevFrameId);
            if (!prev) break;
            head = prev;
        }

        // Walk forward to build the thread
        currentId = head?.id ?? null;
        while (currentId) {
            const frame = this._frames.get(currentId);
            if (!frame) break;
            thread.push(frame);
            currentId = frame.nextFrameId;
        }

        return thread;
    }

    /** Get the first frame (head of the first thread) */
    getFirstFrame(): TextFrame | undefined {
        for (const frame of this._frames.values()) {
            if (!frame.prevFrameId) return frame;
        }
        return this._frames.values().next().value;
    }

    get allFrames(): TextFrame[] {
        return Array.from(this._frames.values());
    }
}
