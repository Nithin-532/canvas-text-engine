import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    // Intercept console messages directly from the page context if it fires later
    const logs = await page.evaluate(() => {
        // Redefine console.log in the page momentarily to catch our custom logs if we want
        // But since we set `window.__loggedValidGlyphs`, let's just read that if it exists.
        return {
            loggedAtlas: window.__loggedAtlas,
            loggedValidGlyphs: window.__loggedValidGlyphs
        };
    });
    console.log("Window state:", logs);
    
    await browser.close();
})();
