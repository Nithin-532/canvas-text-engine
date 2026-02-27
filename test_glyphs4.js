import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Override console.log to stringify objects so we can actually read them
    await page.addInitScript(() => {
        const originalLog = console.log;
        console.log = function(...args) {
            const mapped = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
            originalLog.apply(console, mapped);
        };
    });

    page.on('console', msg => {
        const text = msg.text();
        if (text.includes("GLYPH_DEBUG_DATA")) {
            console.log("BROWSER:", text);
        }
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(4000); 
    await browser.close();
})();
