import { GreedyComposer } from './src/layout/ParagraphComposer';
import type { KnuthPlassElement } from './src/types';

const elements: KnuthPlassElement[] = [
    { type: 'box', width: 90, startOffset: 0, endOffset: 5, glyphs: [], style: {} as any, microStretch: 0, microShrink: 0 },
    { type: 'glue', width: 10, offset: 5, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, offset: 5, flagged: false, penalty: 0 },
    { type: 'box', width: 200, startOffset: 6, endOffset: 12, glyphs: [], style: {} as any, microStretch: 0, microShrink: 0 },
    { type: 'glue', width: 10, offset: 12, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, offset: 12, flagged: false, penalty: -10000 },
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100);
console.log(breaks);
