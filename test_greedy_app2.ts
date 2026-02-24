import { Story } from './src/core/Story';
import { FontManager } from './src/text/FontManager';
import { LayoutEngine } from './src/layout/LayoutEngine';
import { GreedyComposer } from './src/layout/ParagraphComposer';
import { ColumnFlowManager } from './src/layout/ColumnFlowManager';

async function test() {
    const fontManager = new FontManager();
    await fontManager.initialize();
    
    const story = new Story("This is perfec t");
    // force greedy composer
    story.applyParagraphStyle(0, story.length, { composer: 'singleLine' });
    
    const engine = new LayoutEngine(story, fontManager);
    
    // override frame manager to single 50px column to cause wrap
    engine['_frameManager'] = {
        getFirstFrame: () => ({
            id: 'frame1',
            getColumnWidth: () => 100 // Force narrow column
        }),
        allFrames: [{ columns: [{ width: 100, x: 0, y: 0, height: 1000, lines: [] }] }]
    } as any;
    
    const result = engine.compose();
    
    // See where t went
    for (const g of result.glyphs) {
        if (g.char === 't' && g.charOffset > 10) {
           console.log(`char: '${g.char}', x: ${g.x}, y: ${g.y}`);
        }
    }
}
// We must simulate Browser env for vite-node if needed, but vite-node runs in node. 
// Harfbuzz was compiled to WASM. It might work!
test().catch(console.error);
