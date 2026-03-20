import type { KnuthPlassElement, LineBreak } from '../types';

class LinkedListNode<T> {
    prev: LinkedListNode<T> | null = null;
    next: LinkedListNode<T> | null = null;
    constructor(public data: T) { }
}

class LinkedList<T> {
    head: LinkedListNode<T> | null = null;
    tail: LinkedListNode<T> | null = null;
    listSize = 0;

    isLinked(node: LinkedListNode<T>): boolean {
        return !((node.prev === null && node.next === null && this.tail !== node && this.head !== node) || this.isEmpty());
    }

    size(): number { return this.listSize; }
    isEmpty(): boolean { return this.listSize === 0; }
    first(): LinkedListNode<T> | null { return this.head; }

    forEach(fun: (node: LinkedListNode<T>) => void) {
        let node = this.head;
        while (node !== null) {
            fun(node);
            node = node.next;
        }
    }

    insertAfter(node: LinkedListNode<T>, newNode: LinkedListNode<T>): this {
        if (!this.isLinked(node)) return this;
        newNode.prev = node;
        newNode.next = node.next;
        if (node.next === null) {
            this.tail = newNode;
        } else {
            node.next.prev = newNode;
        }
        node.next = newNode;
        this.listSize++;
        return this;
    }

    insertBefore(node: LinkedListNode<T>, newNode: LinkedListNode<T>): this {
        if (!this.isLinked(node)) return this;
        newNode.prev = node.prev;
        newNode.next = node;
        if (node.prev === null) {
            this.head = newNode;
        } else {
            node.prev.next = newNode;
        }
        node.prev = newNode;
        this.listSize++;
        return this;
    }

    push(node: LinkedListNode<T>): this {
        if (this.head === null) {
            this.head = node;
            this.tail = node;
            node.prev = null;
            node.next = null;
            this.listSize++;
        } else {
            this.insertAfter(this.tail!, node);
        }
        return this;
    }

    remove(node: LinkedListNode<T>): this {
        if (!this.isLinked(node)) return this;
        if (node.prev === null) {
            this.head = node.next;
        } else {
            node.prev.next = node.next;
        }
        if (node.next === null) {
            this.tail = node.prev;
        } else {
            node.next.prev = node.prev;
        }
        this.listSize--;
        return this;
    }
}

interface Totals {
    width: number;
    stretch: number;
    shrink: number;
}

interface Breakpoint {
    position: number;
    demerits: number;
    ratio: number;
    line: number;
    fitnessClass: number;
    totals: Totals;
    previous: Breakpoint | null;
}

export class ParagraphComposer {
    compose(
        nodes: KnuthPlassElement[],
        lineWidth: number | ((lineNumber: number) => number),
        tolerance: number = 2
    ): LineBreak[] | null {
        const getLineWidth = typeof lineWidth === 'number'
            ? () => lineWidth
            : lineWidth;

        const options = {
            demerits: { line: 10, flagged: 100, fitness: 3000 },
            tolerance: tolerance
        };

        const activeNodes = new LinkedList<Breakpoint>();
        const sum: Totals = { width: 0, stretch: 0, shrink: 0 };
        const breaks: LineBreak[] = [];
        const infinity = 10000;
        const FORCED_BREAK = -10000;

        let tmp: LinkedListNode<Breakpoint> | null = new LinkedListNode({
            position: 0, demerits: Infinity, ratio: 0, line: 0, fitnessClass: 0, totals: { width: 0, stretch: 0, shrink: 0 }, previous: null
        });

        function createBreakpoint(position: number, demerits: number, ratio: number, line: number, fitnessClass: number, totals: Totals | undefined, previous: Breakpoint | null): Breakpoint {
            return {
                position, demerits, ratio, line, fitnessClass,
                totals: totals || { width: 0, stretch: 0, shrink: 0 },
                previous
            };
        }

        function computeCost(end: number, active: Breakpoint, currentLine: number): number {
            let width = sum.width - active.totals.width;
            const lineLength = getLineWidth(currentLine);

            const endNode = nodes[end];
            if (endNode && endNode.type === 'penalty') {
                width += endNode.width;
            }

            if (width < lineLength) {
                const stretch = sum.stretch - active.totals.stretch;
                if (stretch > 0) {
                    return (lineLength - width) / stretch;
                } else {
                    return infinity;
                }
            } else if (width > lineLength) {
                const shrink = sum.shrink - active.totals.shrink;
                if (shrink > 0) {
                    return (lineLength - width) / shrink;
                } else {
                    return infinity;
                }
            } else {
                return 0;
            }
        }

        function computeSum(breakPointIndex: number): Totals {
            const result = { width: sum.width, stretch: sum.stretch, shrink: sum.shrink };
            for (let i = breakPointIndex; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                if (node.type === 'glue') {
                    result.width += node.width;
                    result.stretch += node.stretch;
                    result.shrink += node.shrink;
                } else if (node.type === 'box' || (node.type === 'penalty' && node.penalty === FORCED_BREAK && i > breakPointIndex)) {
                    break;
                }
            }
            return result;
        }

        function mainLoop(node: KnuthPlassElement, index: number) {
            let active = activeNodes.first();
            while (active !== null) {
                const candidates: { active: LinkedListNode<Breakpoint> | null; demerits: number; ratio: number }[] = [
                    { active: null, demerits: Infinity, ratio: 0 },
                    { active: null, demerits: Infinity, ratio: 0 },
                    { active: null, demerits: Infinity, ratio: 0 },
                    { active: null, demerits: Infinity, ratio: 0 }
                ];

                while (active !== null) {
                    const next: LinkedListNode<Breakpoint> | null = active.next;
                    const currentLine = active.data.line + 1;
                    const ratio = computeCost(index, active.data, currentLine);

                    if (ratio < -1 || (node.type === 'penalty' && node.penalty === FORCED_BREAK)) {
                        activeNodes.remove(active);
                    }

                    if (-1 <= ratio && ratio <= options.tolerance) {
                        const badness = 100 * Math.pow(Math.abs(ratio), 3);
                        let demerits = 0;

                        if (node.type === 'penalty' && node.penalty >= 0) {
                            demerits = Math.pow(options.demerits.line + badness, 2) + Math.pow(node.penalty, 2);
                        } else if (node.type === 'penalty' && node.penalty !== FORCED_BREAK) {
                            demerits = Math.pow(options.demerits.line + badness, 2) - Math.pow(node.penalty, 2);
                        } else {
                            demerits = Math.pow(options.demerits.line + badness, 2);
                        }

                        const flagged = (n: KnuthPlassElement | undefined) => n?.type === 'penalty' && (n as any).flagged ? 1 : 0;
                        if (node.type === 'penalty' && nodes[active.data.position]?.type === 'penalty') {
                            demerits += options.demerits.flagged * flagged(node) * flagged(nodes[active.data.position]);
                        }

                        let currentClass = 0;
                        if (ratio < -0.5) currentClass = 0;
                        else if (ratio <= 0.5) currentClass = 1;
                        else if (ratio <= 1) currentClass = 2;
                        else currentClass = 3;

                        if (Math.abs(currentClass - active.data.fitnessClass) > 1) {
                            demerits += options.demerits.fitness;
                        }

                        demerits += active.data.demerits;

                        if (demerits < candidates[currentClass]!.demerits) {
                            candidates[currentClass] = { active, demerits, ratio };
                        }
                    }

                    active = next;
                    if (active !== null && active.data.line >= currentLine) {
                        break;
                    }
                }

                const tmpSum = computeSum(index);

                for (let fitnessClass = 0; fitnessClass < candidates.length; fitnessClass++) {
                    const candidate = candidates[fitnessClass]!;
                    if (candidate.demerits < Infinity && candidate.active) {
                        const newNode = new LinkedListNode(createBreakpoint(
                            index, candidate.demerits, candidate.ratio,
                            candidate.active.data.line + 1, fitnessClass, tmpSum, candidate.active.data
                        ));
                        if (active !== null) {
                            activeNodes.insertBefore(active, newNode);
                        } else {
                            activeNodes.push(newNode);
                        }
                    }
                }
            }
        }

        activeNodes.push(new LinkedListNode(createBreakpoint(0, 0, 0, 0, 0, undefined, null)));

        nodes.forEach((node, index) => {
            if (node.type === 'box') {
                sum.width += node.width;
            } else if (node.type === 'glue') {
                if (index > 0 && nodes[index - 1]?.type === 'box') {
                    mainLoop(node, index);
                }
                sum.width += node.width;
                sum.stretch += node.stretch;
                sum.shrink += node.shrink;
            } else if (node.type === 'penalty' && node.penalty !== infinity) {
                mainLoop(node, index);
            }
        });

        if (activeNodes.size() !== 0) {
            activeNodes.forEach(node => {
                if (node.data.demerits < tmp!.data.demerits) {
                    tmp = node;
                }
            });

            let finalBrk = tmp ? tmp.data : null;
            while (finalBrk !== null) {
                if (finalBrk.position > 0) {
                    breaks.unshift({
                        breakIndex: finalBrk.position,
                        adjustmentRatio: finalBrk.ratio,
                        fitnessClass: finalBrk.fitnessClass,
                        totalDemerits: finalBrk.demerits
                    });
                }
                finalBrk = finalBrk.previous;
            }
            return breaks;
        }

        if (tolerance < 100) return this.compose(nodes, lineWidth, tolerance * 2);

        return [];
    }
}

// ── GreedyComposer ────────────────────────────────────────────────────────────

/**
 * Simple first-fit (greedy) line breaker.
 *
 * Computes a proper `adjustmentRatio` so that _positionGlyphs can correctly
 * stretch / shrink glue for justified text.
 */
export class GreedyComposer {
    compose(
        elements: KnuthPlassElement[],
        lineWidth: number | ((lineNumber: number) => number),
    ): LineBreak[] {
        const getWidth = typeof lineWidth === 'number' ? () => lineWidth : lineWidth;
        const breaks: LineBreak[] = [];

        let currentWidth = 0;
        let lastBreakOpportunity = -1;

        // Track box/glue totals for the current line (for adjustmentRatio computation)
        let lineBoxW    = 0;
        let lineGlueW   = 0;
        let lineStretch = 0;
        let lineShrink  = 0;

        // Snapshot at the last legal break opportunity
        let snapBoxW    = 0;
        let snapGlueW   = 0;
        let snapStretch = 0;
        let snapShrink  = 0;

        const computeRatio = (targetW: number): number => {
            const nat = snapBoxW + snapGlueW;
            if (nat < targetW && snapStretch > 0) return (targetW - nat) / snapStretch;
            if (nat > targetW && snapShrink  > 0) return (targetW - nat) / snapShrink;
            return 0;
        };

        const resetLine = () => {
            currentWidth = 0;
            lastBreakOpportunity = -1;
            lineBoxW = lineGlueW = lineStretch = lineShrink = 0;
            snapBoxW = snapGlueW = snapStretch = snapShrink = 0;
        };

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i]!;

            // ── Forced break ──────────────────────────────────────────────────
            if (el.type === 'penalty' && (el as { penalty: number }).penalty === -10000) {
                snapBoxW = lineBoxW; snapGlueW = lineGlueW;
                snapStretch = lineStretch; snapShrink = lineShrink;
                breaks.push({
                    breakIndex: i,
                    adjustmentRatio: 0, // Last line — no forced stretch
                    fitnessClass: 1,
                    totalDemerits: 0,
                });
                resetLine();
                continue;
            }

            // ── Track legal break opportunities ───────────────────────────────
            if (el.type === 'glue' ||
                (el.type === 'penalty' &&
                 (el as { penalty: number }).penalty >= 0 &&
                 (el as { penalty: number }).penalty < 10000)) {
                lastBreakOpportunity = i;
                snapBoxW    = lineBoxW;
                snapGlueW   = lineGlueW;
                snapStretch = lineStretch;
                snapShrink  = lineShrink;
            }

            const elW = (el.type === 'box' || el.type === 'glue') ? el.width : 0;

            // ── Overflow check ────────────────────────────────────────────────
            if (currentWidth + elW > getWidth(breaks.length + 1)) {
                if (currentWidth === 0) {
                    // Element alone is wider than the slot (polygon wrap scenario).
                    let found = false;
                    for (let peek = 1; peek <= 20; peek++) {
                        if (getWidth(breaks.length + 1 + peek) >= elW) { found = true; break; }
                    }
                    if (found) {
                        snapBoxW = snapGlueW = snapStretch = snapShrink = 0;
                        breaks.push({
                            breakIndex: i > 0 ? i - 1 : 0,
                            adjustmentRatio: 0,
                            fitnessClass: 1,
                            totalDemerits: 0,
                        });
                        resetLine();
                        i--; // Re-evaluate this element for the next slot
                        continue;
                    }
                    // No wider slot ahead — let it overflow naturally
                } else if (lastBreakOpportunity !== -1) {
                    const target = getWidth(breaks.length + 1);
                    breaks.push({
                        breakIndex: lastBreakOpportunity,
                        adjustmentRatio: computeRatio(target),
                        fitnessClass: 1,
                        totalDemerits: 0,
                    });
                    i = lastBreakOpportunity;
                    resetLine();
                    continue;
                } else {
                    // No legal break — force one before current element
                    const fb = i > 0 ? i - 1 : i;
                    snapBoxW = lineBoxW; snapGlueW = lineGlueW;
                    snapStretch = lineStretch; snapShrink = lineShrink;
                    breaks.push({
                        breakIndex: fb,
                        adjustmentRatio: computeRatio(getWidth(breaks.length + 1)),
                        fitnessClass: 1,
                        totalDemerits: 0,
                    });
                    i = fb;
                    resetLine();
                    continue;
                }
            }

            // ── Accumulate ────────────────────────────────────────────────────
            if (el.type === 'box') {
                lineBoxW += el.width;
            } else if (el.type === 'glue') {
                lineGlueW   += el.width;
                lineStretch += el.stretch;
                lineShrink  += el.shrink;
            }
            currentWidth += elW;
        }

        // Flush last (partial) line — ratio 0 (no forced stretch on last line)
        if (currentWidth > 0 || lineBoxW > 0) {
            const lastIdx = elements.length - 1;
            if (breaks.length === 0 || breaks[breaks.length - 1]!.breakIndex !== lastIdx) {
                breaks.push({
                    breakIndex: lastIdx,
                    adjustmentRatio: 0,
                    fitnessClass: 1,
                    totalDemerits: 0,
                });
            }
        }

        return breaks;
    }
}
