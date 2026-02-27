import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes("recompose") || text.includes("GLYPH") || text.includes("WebGL") || text.includes("Ready")) {
            console.log("BROWSER:", text);
        }
    });

    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    await browser.close();
})();
