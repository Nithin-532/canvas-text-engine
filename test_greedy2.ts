import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';
import { FontManager } from './src/shaping/FontManager';

const fontManager = new FontManager();
const flowManager = new ColumnFlowManager(fontManager);

const elements: any[] = [
    { type: 'box', width: 90, startOffset: 0, endOffset: 5, glyphs: [], style: { fontSize: 14 } as any },
    { type: 'glue', width: 20, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, penalty: 0 },
    { type: 'box', width: 90, startOffset: 6, endOffset: 12, glyphs: [], style: { fontSize: 14 } as any },
    { type: 'glue', width: 20, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, penalty: -10000 },
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements as any, 100);
console.log("Breaks:", breaks);

const lines = flowManager.buildComposedLines(elements as any, breaks, { leading: 1.4, alignment: 'left' } as any);
console.log("Lines:");
lines.forEach((l, i) => {
    console.log(`Line ${i}:`, l.elements.map(e => e.type));
});
