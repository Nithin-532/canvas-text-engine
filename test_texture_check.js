import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes("TEXTURE_CHECK") || text.includes("Fragment Shader") || text.includes("Program Link")) {
            console.log(text);
        }
    });

    await page.addInitScript(() => {
        const origTexImage2D = WebGL2RenderingContext.prototype.texImage2D;
        WebGL2RenderingContext.prototype.texImage2D = function(...args) {
            const res = origTexImage2D.apply(this, args);
            // If the source is an HTMLCanvasElement, read it back
            const lastArg = args[args.length - 1];
            if (lastArg instanceof HTMLCanvasElement) {
                const ctx = lastArg.getContext('2d');
                if (ctx) {
                    const imgData = ctx.getImageData(0, 0, lastArg.width, lastArg.height);
                    const d = imgData.data;
                    // Sample first 25 RGBA values
                    const samples = [];
                    for (let i = 0; i < Math.min(100, d.length); i += 4) {
                        samples.push(`[${d[i]},${d[i+1]},${d[i+2]},${d[i+3]}]`);
                    }
                    console.log("TEXTURE_CHECK first 25 pixels: " + samples.join(", "));
                    // Find a non-background pixel
                    for (let i = 0; i < d.length; i += 4) {
                        if (d[i] !== d[0] || d[i+1] !== d[1] || d[i+2] !== d[2]) {
                            console.log("TEXTURE_CHECK first non-bg pixel at offset " + (i/4) + ": [" + d[i] + "," + d[i+1] + "," + d[i+2] + "," + d[i+3] + "]");
                            break;
                        }
                    }
                }
            }
            return res;
        };
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(4000); 
    await browser.close();
})();
