import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        const t = msg.text();
        if (t.includes("TEXDUMP") || t.includes("ATLAS_DUMP") || t.includes("GLYPH_DEBUG_DATA")) {
            console.log(t);
        }
    });
    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(5000); 
    await browser.close();
})();
