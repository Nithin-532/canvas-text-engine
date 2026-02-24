import { Story } from './src/core/Story';
import { FontManager } from './src/shaping/FontManager';
import { ShapingPipeline } from './src/shaping/ShapingPipeline';
import { buildElements } from './src/layout/KnuthPlassElements';
import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

async function test() {
    const fontManager = new FontManager();
    const story = new Story("Typography is the art and technique of arranging type to make written ffi fi fl ffl fflanguage legible, readable, and appealing when displayed ijoidj coid coid icd cdcd oihd coidh idh coidhc odh coidh coidhc doihc id coidh cidh cidh coidh coidhc oihc oihc. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing (leading), and letter-spacing (tracking), as well as adjusting the space between pairs of letters (kerning).", undefined, { alignment: 'left', leading: 1.4 });
    const pipeline = new ShapingPipeline(fontManager);

    // We don't load fonts to keep it simple, it'll use fallback measurements
    const paragraphs = pipeline.shapeStory(story);
    const shaped = paragraphs[0];
    const elements = buildElements(shaped, (units, size) => units / 1000 * size);

    console.log("Total elements:", elements.length);
    const composer = new GreedyComposer();
    const breaks = composer.compose(elements, 200);
    console.log(`Greedy found ${breaks.length} breaks.`);

    const flowManager = new ColumnFlowManager(fontManager);
    const lines = flowManager.buildComposedLines(elements, breaks, story.defaultParagraphStyle);
    console.log(`Generated ${lines.length} lines.`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let text = line.elements.filter(e => e.type === 'box').map(e => e.glyphs.map(g => g.char).join('')).join(' ');
        console.log(`Line ${i}:`, text);
    }
}
test();
