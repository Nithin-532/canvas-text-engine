import { Story } from './src/core/Story';
import { FontManager } from './src/shaping/FontManager';
import { ShapingPipeline } from './src/shaping/ShapingPipeline';
import { buildElements } from './src/layout/KnuthPlassElements';
import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

async function test() {
    const fontManager = new FontManager();
    await fontManager.init(); // Need WASM for shaped paragraph layout

    const story = new Story("A\n\n\nB", undefined, { alignment: 'left', leading: 1.4, fontSize: 16 });
    const pipeline = new ShapingPipeline(fontManager);

    const paragraphs = pipeline.shapeStory(story);
    const flowManager = new ColumnFlowManager(fontManager);
    let totalLines = 0;

    for (let i = 0; i < paragraphs.length; i++) {
        const shaped = paragraphs[i];
        const elements = buildElements(shaped, (units, size) => units / 1000 * size);
        console.log(`Paragraph ${i} (length: ${shaped.text.length}) - elements:`, elements.map(e => e.type));

        const composer = new GreedyComposer();
        const breaks = composer.compose(elements, 200);
        console.log(`  Breaks:`, breaks);

        const lines = flowManager.buildComposedLines(elements, breaks, story.defaultParagraphStyle);
        console.log(`  Generated lines:`, lines.length, lines.map(l => l.lineHeight));
        totalLines += lines.length;
    }
    console.log("Total flow lines:", totalLines);
}
test().catch(console.error);
