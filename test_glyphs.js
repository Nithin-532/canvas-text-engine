import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Listen for console logs
    page.on('console', msg => {
        if (msg.text().includes("ATLAS_DUMP") || msg.text().includes("GLYPH_DEBUG")) {
            console.log(msg.text());
        }
    });
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    await browser.close();
})();
