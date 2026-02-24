import { Story } from './src/core/Story';
import { FontManager } from './src/core/FontManager';
import { LayoutEngine } from './src/layout/LayoutEngine';

async function test() {
    const fontManager = new FontManager();
    await fontManager.initialize();
    
    const story = new Story("This is perfec t");
    // force greedy composer
    story.applyParagraphStyle(0, story.length, { composer: 'singleLine' });
    
    // Create a dummy layout engine
    const engine = new LayoutEngine(story, fontManager);
    
    // Mock the frame manager to return a specific column width
    engine['_frameManager'] = {
        getFirstFrame: () => ({
            id: 'frame1',
            getColumnWidth: () => 100 // Force narrow column
        })
    } as any;
    
    // Run compose
    const result = engine.compose();
    
    // See where t went
    for (const g of result.glyphs) {
        console.log(`char: '${g.char}', x: ${g.x}, y: ${g.y}`);
    }
}
test();
