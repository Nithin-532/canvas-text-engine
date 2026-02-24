import { GreedyComposer } from './src/layout/ParagraphComposer';

const elements: any[] = [
    { type: 'box', width: 20, startOffset: 0, endOffset: 2 }, // "in"
    { type: 'glue', width: 10, offset: 2 }, // " "
    { type: 'box', width: 40, startOffset: 3, endOffset: 4 }, // "g"
    { type: 'glue', width: 10, offset: 4 }, // " "
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 50); // Small column to force breaking at 'g'
console.log("Breaks:", breaks);
