import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    
    // Test 1: Hide UI Canvas, Show WebGL Canvas
    const page1 = await browser.newPage();
    await page1.goto('http://localhost:5173/');
    await page1.waitForTimeout(5000); 
    await page1.evaluate(() => {
        document.querySelectorAll('canvas')[1].style.display = 'none';
    });
    await page1.screenshot({ path: '/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/isolate_gl.png' });
    await page1.close();

    // Test 2: Hide WebGL Canvas, Show UI Canvas
    const page2 = await browser.newPage();
    await page2.goto('http://localhost:5173/');
    await page2.waitForTimeout(5000); 
    await page2.evaluate(() => {
        document.querySelectorAll('canvas')[0].style.display = 'none';
    });
    await page2.screenshot({ path: '/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/isolate_ui.png' });
    await page2.close();

    console.log('Saved isolated screenshots');
    await browser.close();
})();
