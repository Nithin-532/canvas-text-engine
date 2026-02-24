import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

const elements: any[] = [
    { type: 'box', width: 95, startOffset: 0, endOffset: 14 }, // "This is perfec"
    { type: 'glue', width: 4, offset: 14 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 14 }, // opportunity
    { type: 'box', width: 10, startOffset: 15, endOffset: 16 }, // "t"
    { type: 'glue', width: 4, offset: 16 }, // " "
    { type: 'penalty', width: 0, penalty: -10000, offset: 16 }, // end
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100); 
console.log("Breaks:", breaks);
