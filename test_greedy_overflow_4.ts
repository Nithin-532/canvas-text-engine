import { GreedyComposer } from './src/layout/ParagraphComposer';

const elements: any[] = [
    { type: 'box', width: 98, startOffset: 0, endOffset: 6 }, // "perfec"
    { type: 'glue', width: 4, offset: 6 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 6 }, 
    { type: 'box', width: 10, startOffset: 7, endOffset: 8 }, // "t"
    { type: 'glue', width: 4, offset: 8 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 8 }, 
    { type: 'box', width: 50, startOffset: 9, endOffset: 16 }, // "workers"
    { type: 'penalty', width: 0, penalty: -10000, offset: 16 },
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100); 
console.log("Breaks:", breaks);
