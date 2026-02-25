/* ═══════════════════════════════════════════════════════════════
   BentleyOttmann.ts — Efficient Sweep-Line Active Segment Set

   For polygon frames with many edges (> 8 segments), a naïve
   O(n) per-scanline intersection check is acceptable. For very
   complex frames (custom shapes, import from SVG) we want an
   event-driven sweep that maintains a sorted active-segment set.

   This implementation provides a lightweight version suitable for
   text layout (non-self-intersecting polygons primarily):

   - Segments are sorted by their Y extent
   - For a given scanY, only segments whose Y range includes scanY
     are returned ("active segments")
   - Active segments are sorted by their X at that Y

   This covers the main performance need (avoid checking inactive
   segments) without implementing the full Bentley-Ottmann crossing
   detection (not needed for simple non-self-intersecting frames).
   ═══════════════════════════════════════════════════════════════ */

import type { Segment } from './Polygon';
import { segmentXAtY } from './Polygon';

interface ActiveSegmentEntry {
    segment: Segment;
    minY: number;
    maxY: number;
}

export class BentleyOttmannSweep {
    private _entries: ActiveSegmentEntry[];

    constructor(segments: Segment[]) {
        this._entries = segments.map(seg => ({
            segment: seg,
            minY: Math.min(seg.p1.y, seg.p2.y),
            maxY: Math.max(seg.p1.y, seg.p2.y),
        }));
        // Pre-sort by minY so we can binary-search for start
        this._entries.sort((a, b) => a.minY - b.minY);
    }

    /**
     * Return segments that are active (crossing) at scanY,
     * sorted by their X coordinate at that Y.
     */
    getActiveSegmentsAt(scanY: number): Array<{ segment: Segment; x: number }> {
        const active: Array<{ segment: Segment; x: number }> = [];
        for (const entry of this._entries) {
            // Early exit: entries are sorted by minY, once minY > scanY no more can be active
            if (entry.minY > scanY) break;
            if (entry.maxY <= scanY) continue;  // below scanY

            const x = segmentXAtY(entry.segment, scanY);
            if (x !== null) {
                active.push({ segment: entry.segment, x });
            }
        }
        // Sort by X
        active.sort((a, b) => a.x - b.x);
        return active;
    }

    /**
     * Get sorted X intersections at scanY.
     */
    getXsAt(scanY: number): number[] {
        return this.getActiveSegmentsAt(scanY).map(e => e.x);
    }
}
