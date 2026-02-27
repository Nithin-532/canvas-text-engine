import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(10000); // wait for 'Ready'
    
    await page.screenshot({ path: '/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/shader_debug_screenshot.png' });
    
    console.log('Screenshot saved.');
    await browser.close();
})();
