import { GreedyComposer } from './src/layout/ParagraphComposer';

const elements: any[] = [
    { type: 'box', width: 40, startOffset: 0, endOffset: 4 }, // "word"
    { type: 'glue', width: 10, offset: 4 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 4 }, // break chance
    { type: 'box', width: 80, startOffset: 5, endOffset: 12 }, // "another"
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100);
console.log("Breaks:", breaks);
