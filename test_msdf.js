import { MSDF } from '@zappar/msdf-generator';
import fs from 'fs';

async function test() {
    try {
        const fontData = fs.readFileSync('public/fonts/Roboto-Regular.ttf');
        const msdf = new MSDF();
        await msdf.initialize();

        const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:",./<>?';

        // 1. Generate full charset
        console.time('generateAtlas (full)');
        const fullAtlas = await msdf.generateAtlas({
            font: fontData,
            charset: charset,
            fieldRange: 4,
            textureSize: [512, 512] // Fixed size might fail if characters don't fit, but 512x512 is usually enough for ascii
        });
        console.timeEnd('generateAtlas (full)');
        console.log("Full Atlas size:", fullAtlas.textureSize, "Glyphs:", fullAtlas.glyphs.length);

        // 2. Generate single character
        console.time('generateAtlas (single)');
        const singleAtlas = await msdf.generateAtlas({
            font: fontData,
            charset: 'A',
            fieldRange: 4,
            textureSize: [64, 64]
        });
        console.timeEnd('generateAtlas (single)');
        console.log("Single Atlas size:", singleAtlas.textureSize, "Glyphs:", singleAtlas.glyphs.length);

        await msdf.dispose();
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
