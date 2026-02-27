import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    await page.evaluate(() => {
        const canvases = document.querySelectorAll('canvas');
        canvases.forEach(c => c.style.display = 'none');
    });
    
    await page.screenshot({ path: '/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/hidden_canvases.png' });
    
    console.log('Saved hidden canvases screenshot');
    await browser.close();
})();
