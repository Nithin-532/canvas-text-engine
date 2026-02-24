import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

const mockFontManager = {
    fontUnitsToPixels: (units: number, size: number) => units / 1000 * size
} as any;

const elements: any[] = [
    { type: 'box', width: 300, startOffset: 0, endOffset: 15, glyphs: [], style: { fontSize: 20 } },
    { type: 'glue', width: 10, offset: 15, stretch: 5, shrink: 3 },
    { type: 'box', width: 50, startOffset: 16, endOffset: 20, glyphs: [], style: { fontSize: 20 } },
    { type: 'penalty', width: 0, penalty: -10000, offset: 20 },
];

const composer = new GreedyComposer();
// column width is 100. First box is 300!
const breaks = composer.compose(elements, 100);
console.log("Breaks:", breaks);

const flowManager = new ColumnFlowManager(mockFontManager);
const lines = flowManager.buildComposedLines(elements, breaks, { leading: 1.5, alignment: 'left' } as any);

for (let i = 0; i < lines.length; i++) {
    console.log(`Line ${i} -> Height: ${lines[i].lineHeight}, Offset: [${lines[i].startOffset}, ${lines[i].endOffset}]`);
    console.log(` Elements indices:`, lines[i].elements.map(e => e.type));
}
