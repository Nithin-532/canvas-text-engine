import { GreedyComposer } from './dist/layout/ParagraphComposer.js';
import { ColumnFlowManager } from './dist/layout/ColumnFlowManager.js';

// We just mock font manager
const mockFontManager = {
    fontUnitsToPixels: (units, size) => units / 1000 * size
};

const elements = [
    { type: 'box', width: 50, startOffset: 0, endOffset: 5, glyphs: [], style: { fontSize: 20 } },
    { type: 'glue', width: 10, offset: 5, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, penalty: 0, offset: 5 },
    { type: 'box', width: 60, startOffset: 6, endOffset: 12, glyphs: [], style: { fontSize: 20 } },
    { type: 'glue', width: 10, offset: 12, stretch: 5, shrink: 3 },
    { type: 'penalty', width: 0, penalty: -10000, offset: 12 },
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100);
console.log("Breaks:", breaks);

const flowManager = new ColumnFlowManager(mockFontManager);
const lines = flowManager.buildComposedLines(elements, breaks, { leading: 1.5, alignment: 'left' });

for (let i = 0; i < lines.length; i++) {
    console.log(`Line ${i} -> Height: ${lines[i].lineHeight}, Offset: [${lines[i].startOffset}, ${lines[i].endOffset}]`);
    console.log(` Elements indices:`, lines[i].elements.length);
}
