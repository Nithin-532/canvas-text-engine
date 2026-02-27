import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    const isBlack = await page.evaluate(() => {
        const uiCanvas = document.querySelectorAll('canvas')[1];
        const ctx = uiCanvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, 10, 10).data;
        return {
            r: pixels[0], g: pixels[1], b: pixels[2], a: pixels[3]
        };
    });
    console.log("UI Canvas pixel [0,0]:", isBlack);
    
    await browser.close();
})();
