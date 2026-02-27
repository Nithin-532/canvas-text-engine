import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes("ATLAS") || text.includes("GLYPH") || text.includes("Ready") || text.includes("Error")) {
            console.log("BROWSER:", text);
        }
    });

    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    await browser.close();
})();
