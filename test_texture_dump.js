import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().includes("TEXDUMP")) console.log(msg.text());
    });

    await page.addInitScript(() => {
        const origTexImage2D = WebGL2RenderingContext.prototype.texImage2D;
        WebGL2RenderingContext.prototype.texImage2D = function(...args) {
            const res = origTexImage2D.apply(this, args);
            // Check if raw byte upload (9 args)
            if (args.length >= 9 && args[8] instanceof Uint8Array) {
                const bytes = args[8];
                const w = args[3];
                const h = args[4];
                
                // Sample pixels across the first glyph area
                const samples = [];
                // First row of pixels
                for (let x = 0; x < Math.min(30, w); x++) {
                    const idx = x * 4;
                    samples.push(`(${bytes[idx]},${bytes[idx+1]},${bytes[idx+2]})`);
                }
                console.log("TEXDUMP row0: " + samples.join(" "));
                
                // Middle rows
                for (let y of [5, 10, 15, 20]) {
                    if (y >= h) break;
                    const rowSamples = [];
                    for (let x = 0; x < Math.min(30, w); x++) {
                        const idx = (y * w + x) * 4;
                        rowSamples.push(`(${bytes[idx]},${bytes[idx+1]},${bytes[idx+2]})`);
                    }
                    console.log(`TEXDUMP row${y}: ` + rowSamples.join(" "));
                }
                
                // Count value distribution
                let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
                for (let i = 0; i < bytes.length; i += 4) {
                    minR = Math.min(minR, bytes[i]);
                    maxR = Math.max(maxR, bytes[i]);
                    minG = Math.min(minG, bytes[i+1]);
                    maxG = Math.max(maxG, bytes[i+1]);
                    minB = Math.min(minB, bytes[i+2]);
                    maxB = Math.max(maxB, bytes[i+2]);
                }
                console.log(`TEXDUMP ranges: R=[${minR}-${maxR}], G=[${minG}-${maxG}], B=[${minB}-${maxB}]`);
            }
            return res;
        };
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(4000); 
    await browser.close();
})();
