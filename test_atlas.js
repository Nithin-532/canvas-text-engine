import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Inject a script to pull the atlas from the window object if we expose it
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(2000);
    
    // Check if the React App crashes
    const errorCount = await page.evaluate(() => {
        return window.__reactErrorCount || 0;
    });
    
    console.log('Test completed.');
    await browser.close();
})();
