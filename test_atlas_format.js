import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Listen for console logs
    page.on('console', msg => {
        console.log(msg.text());
    });
    
    await page.goto('http://localhost:5173/');
    
    // Wait for the specific element to appear that means the layout has finished
    await page.waitForTimeout(10000);
    
    await browser.close();
})();
