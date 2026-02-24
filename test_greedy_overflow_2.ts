import { GreedyComposer } from './src/layout/ParagraphComposer';

const elements: any[] = [
    { type: 'box', width: 90, startOffset: 0, endOffset: 6 }, // "perfec"
    { type: 'glue', width: 5, offset: 6 }, // " "
    { type: 'penalty', width: 0, penalty: 0, offset: 6 }, // break space
    { type: 'box', width: 10, startOffset: 7, endOffset: 8 }, // "t"
];

const composer = new GreedyComposer();
const breaks = composer.compose(elements, 100); 
console.log("Breaks:", breaks);
