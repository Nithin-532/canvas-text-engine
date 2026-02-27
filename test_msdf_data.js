import { MSDF } from '@zappar/msdf-generator';
import fs from 'fs';

async function test() {
    try {
        const fontData = fs.readFileSync('public/fonts/Roboto-Regular.ttf');
        const msdf = new MSDF();
        await msdf.initialize();

        const atlas = await msdf.generateAtlas({
            font: fontData,
            charset: 'A',
            fieldRange: 4,
            textureSize: [64, 64]
        });
        
        console.log("Image Data length:", atlas.texture.data.length);
        console.log("First 64 pixels:", Array.from(atlas.texture.data.subarray(0, 64 * 4)));
        await msdf.dispose();
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
