/* ═══════════════════════════════════════════════════════════════
   Polygon.ts — Core Geometry Primitives

   Provides the fundamental geometric types and algorithms used by
   the Phase 7 scanline text-wrapping engine:

   - Point, Segment, Polygon types
   - segmentXAtY()    — horizontal scanline/segment intersection
   - polygonToSegments() — decompose polygon into edge segments
   - pointInPolygon() — even-odd ray casting test
   ═══════════════════════════════════════════════════════════════ */

/** A 2D point in page coordinates (px) */
export interface Point {
    x: number;
    y: number;
}

/** A directed line segment between two points */
export interface Segment {
    p1: Point;
    p2: Point;
}

/** A closed polygon defined by an ordered list of vertices */
export interface Polygon {
    points: Point[];
}

/** A horizontal interval on the X axis */
export interface Interval {
    x: number;
    width: number;
}

/**
 * Decompose a polygon into its edge segments.
 * The last point wraps back to the first.
 */
export function polygonToSegments(poly: Polygon): Segment[] {
    const pts = poly.points;
    const segments: Segment[] = [];
    for (let i = 0; i < pts.length; i++) {
        segments.push({
            p1: pts[i]!,
            p2: pts[(i + 1) % pts.length]!,
        });
    }
    return segments;
}

/**
 * Compute the X coordinate where a segment crosses the horizontal line y = scanY.
 * Returns null if the segment doesn't cross that Y level.
 *
 * Uses the standard parametric intersection:
 *   t = (scanY - p1.y) / (p2.y - p1.y)
 *   x = p1.x + t * (p2.x - p1.x)
 */
export function segmentXAtY(seg: Segment, scanY: number): number | null {
    const { p1, p2 } = seg;
    // Segment must cross scanY (exclusive of both endpoints to avoid counting corners twice)
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    if (scanY < minY || scanY >= maxY) return null;

    const t = (scanY - p1.y) / (p2.y - p1.y);
    return p1.x + t * (p2.x - p1.x);
}

/**
 * Get all X intersections of a polygon's edges with the horizontal line y = scanY.
 * Sorted left-to-right.
 */
export function polygonXIntersections(poly: Polygon, scanY: number): number[] {
    const xs: number[] = [];
    for (const seg of polygonToSegments(poly)) {
        const x = segmentXAtY(seg, scanY);
        if (x !== null) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    return xs;
}

/**
 * Convert sorted X intersections from a scanline into [enter, exit] intervals.
 * Pairs up intersections: [x0,x1], [x2,x3], ...
 */
export function intersectionsToIntervals(xs: number[]): Interval[] {
    const intervals: Interval[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
        const left = xs[i]!;
        const right = xs[i + 1]!;
        if (right > left) {
            intervals.push({ x: left, width: right - left });
        }
    }
    return intervals;
}

/**
 * Point-in-polygon test using even-odd rule (ray casting).
 * Casts a ray rightward from (px, py) and counts crossings.
 */
export function pointInPolygon(pt: Point, poly: Polygon): boolean {
    let inside = false;
    const pts = poly.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const pi = pts[i]!;
        const pj = pts[j]!;
        if (
            (pi.y > pt.y) !== (pj.y > pt.y) &&
            pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Subtract exclusion intervals from a set of base intervals.
 * Returns the remaining non-excluded portions.
 *
 * Example:
 *   base:      [  10 ── 200  ]
 *   exclusion: [  80 ── 120  ]
 *   result:    [10──80] [120──200]
 */
export function subtractInterval(base: Interval, exclude: Interval): Interval[] {
    const bEnd = base.x + base.width;
    const eEnd = exclude.x + exclude.width;

    // No overlap
    if (exclude.x >= bEnd || eEnd <= base.x) return [base];

    const result: Interval[] = [];
    // Portion to the left of exclusion
    if (base.x < exclude.x) {
        result.push({ x: base.x, width: exclude.x - base.x });
    }
    // Portion to the right of exclusion
    if (eEnd < bEnd) {
        result.push({ x: eEnd, width: bEnd - eEnd });
    }
    return result;
}

/**
 * Subtract multiple exclusion intervals from a base interval list.
 */
export function subtractIntervals(bases: Interval[], exclusions: Interval[]): Interval[] {
    let remaining = bases;
    for (const excl of exclusions) {
        const next: Interval[] = [];
        for (const base of remaining) {
            next.push(...subtractInterval(base, excl));
        }
        remaining = next;
    }
    return remaining;
}

/**
 * Create a polygon approximating an ellipse (for demo wrap objects).
 * @param cx Centre X
 * @param cy Centre Y
 * @param rx Radius X
 * @param ry Radius Y
 * @param segments Number of vertices (default 24)
 */
export function makeEllipsePolygon(cx: number, cy: number, rx: number, ry: number, segments = 24): Polygon {
    const points: Point[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (2 * Math.PI * i) / segments;
        points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
    return { points };
}

/**
 * Expand a polygon outward by `padding` pixels on all sides.
 * Uses a simple centroid-based push.
 */
export function expandPolygon(poly: Polygon, padding: number): Polygon {
    const cx = poly.points.reduce((s, p) => s + p.x, 0) / poly.points.length;
    const cy = poly.points.reduce((s, p) => s + p.y, 0) / poly.points.length;
    return {
        points: poly.points.map(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / len) * padding, y: p.y + (dy / len) * padding };
        }),
    };
}
