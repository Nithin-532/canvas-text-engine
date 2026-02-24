import { ColumnFlowManager } from './src/layout/ColumnFlowManager';
import { GreedyComposer } from './src/layout/ParagraphComposer';

const elements: any[] = [
    { type: 'box', width: 20, startOffset: 0, endOffset: 2, style: { fontSize: 14 } }, // "in"
    { type: 'glue', width: 10, offset: 2 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 2 }, // break
    { type: 'box', width: 40, startOffset: 3, endOffset: 4, style: { fontSize: 14 } }, // "g"
    { type: 'glue', width: 10, offset: 4 }, // " "
    { type: 'penalty', width: 0, penalty: -10000, offset: 4 }, // break
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 50); // Small column to force breaking at 'g'

const flowManager = new ColumnFlowManager({ fontUnitsToPixels: () => 10 } as any);
const lines = flowManager.buildComposedLines(elements, breaks, { leading: 1.5, alignment: 'left' } as any);

for (let i = 0; i < lines.length; i++) {
    console.log(`Line ${i}:`, lines[i].elements.map(e => e.type));
}
