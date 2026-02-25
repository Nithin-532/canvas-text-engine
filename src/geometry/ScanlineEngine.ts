/* ═══════════════════════════════════════════════════════════════
   ScanlineEngine.ts — Available Text Interval Computer

   Given a frame polygon and a set of wrap-exclusion polygons,
   computes the set of available horizontal intervals [x, width]
   where text can flow at a given Y band.

   Used by ColumnFlowManager to determine the effective line width
   and startX for each text line, enabling:
   - Non-rectangular text frames (triangle, ellipse, L-shape…)
   - Text wrapping around embedded objects
   ═══════════════════════════════════════════════════════════════ */

import type { Polygon, Interval } from './Polygon';
import {
    polygonToSegments,
    segmentXAtY,
    intersectionsToIntervals,
    subtractIntervals,
} from './Polygon';
import { BentleyOttmannSweep } from './BentleyOttmann';

const COMPLEX_THRESHOLD = 8; // Use BentleyOttmann sweep above this many segments

export interface WrapPolygon {
    polygon: Polygon;
    padding: number;
}

export class ScanlineEngine {
    /**
     * Compute available text intervals for the band [y, y + lineHeight].
     *
     * We sample at top, mid, and bottom of the band and take the intersection
     * (narrowest available width) for safety across the line's full height.
     *
     * @param framePolygon  The frame boundary (text flows INSIDE)
     * @param exclusions    Wrap objects (text flows OUTSIDE + padding)
     * @param y             Top of the line band (page coordinates)
     * @param lineHeight    Height of the line band
     */
    getAvailableIntervals(
        framePolygon: Polygon,
        exclusions: WrapPolygon[],
        y: number,
        lineHeight: number,
    ): Interval[] {
        // Sample at top, mid, and bottom of the band
        const samples = [y + 1, y + lineHeight * 0.5, y + lineHeight - 1];
        let result: Interval[] | null = null;

        for (const scanY of samples) {
            const frameIntervals = this._frameIntervalsAt(framePolygon, scanY);
            const excIntervals = exclusions.flatMap(e => this._exclusionIntervalsAt(e, scanY));
            const available = subtractIntervals(frameIntervals, excIntervals);

            if (result === null) {
                result = available;
            } else {
                result = this._intersectIntervalSets(result, available);
            }
        }

        return result ?? [];
    }

    /**
     * Rectangle-only shortcut that still handles wrap exclusions.
     * Avoids polygon math for standard AABB frames.
     */
    getRectIntervals(
        x: number,
        width: number,
        exclusions: WrapPolygon[],
        y: number,
        lineHeight: number,
    ): Interval[] {
        const baseIntervals: Interval[] = [{ x, width }];
        if (exclusions.length === 0) return baseIntervals;

        // Sample at top, mid, and bottom of the band.
        // Compute available intervals independently for each sample, then take
        // the intersection (narrowest safe space) — same logic as getAvailableIntervals.
        const samples = [y + 1, y + lineHeight * 0.5, y + lineHeight - 1];
        let result: Interval[] | null = null;

        for (const scanY of samples) {
            const excIntervals = exclusions.flatMap(e => this._exclusionIntervalsAt(e, scanY));
            const available = subtractIntervals(baseIntervals, excIntervals);

            if (result === null) {
                result = available;
            } else {
                result = this._intersectIntervalSets(result, available);
            }
        }

        return result ?? baseIntervals;
    }

    // ── Private helpers ──────────────────────────────────────────

    private _frameIntervalsAt(poly: Polygon, scanY: number): Interval[] {
        const segs = polygonToSegments(poly);
        let xs: number[];

        if (segs.length > COMPLEX_THRESHOLD) {
            const sweep = new BentleyOttmannSweep(segs);
            xs = sweep.getXsAt(scanY);
        } else {
            xs = [];
            for (const seg of segs) {
                const x = segmentXAtY(seg, scanY);
                if (x !== null) xs.push(x);
            }
            xs.sort((a, b) => a - b);
        }

        return intersectionsToIntervals(xs);
    }

    private _exclusionIntervalsAt(wrap: WrapPolygon, scanY: number): Interval[] {
        const segs = polygonToSegments(wrap.polygon);
        const xs: number[] = [];
        for (const seg of segs) {
            const x = segmentXAtY(seg, scanY);
            if (x !== null) xs.push(x);
        }
        xs.sort((a, b) => a - b);
        const intervals = intersectionsToIntervals(xs);

        // Expand intervals by padding
        return intervals.map(iv => ({
            x: iv.x - wrap.padding,
            width: iv.width + 2 * wrap.padding,
        }));
    }

    /** Return the intersection (overlap) of two interval sets */
    private _intersectIntervalSets(a: Interval[], b: Interval[]): Interval[] {
        const result: Interval[] = [];
        for (const ia of a) {
            for (const ib of b) {
                const left = Math.max(ia.x, ib.x);
                const right = Math.min(ia.x + ia.width, ib.x + ib.width);
                if (right > left) {
                    result.push({ x: left, width: right - left });
                }
            }
        }
        return result;
    }
}
