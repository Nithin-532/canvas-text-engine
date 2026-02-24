import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

const elements: any[] = [
    { type: 'box', width: 80, startOffset: 0, endOffset: 6 }, // "perfec"
    { type: 'glue', width: 5, offset: 6 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 6 }, 
    { type: 'glue', width: 5, offset: 7 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 7 }, 
    { type: 'glue', width: 5, offset: 8 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 8 }, 
    { type: 'box', width: 10, startOffset: 9, endOffset: 10 }, // "t"
    { type: 'penalty', width: 0, penalty: -10000, offset: 10 }, // EOF
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100); 
console.log("Breaks:", breaks);

const flowManager = new ColumnFlowManager({ fontUnitsToPixels: () => 10 } as any);
const lines = flowManager.buildComposedLines(elements, breaks, { leading: 1.5, alignment: 'left' } as any);

for (let line of lines) {
    console.log(`Line width: ${line.width} (natural: ${line.elements.reduce((sum, el) => sum + (el.type === 'box' || el.type === 'glue' ? el.width : 0), 0)}) elements:`, line.elements.map(e => e.type));
}
