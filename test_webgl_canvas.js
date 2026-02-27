import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Listen for console logs
    page.on('console', msg => {
        console.log(msg.text());
    });
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    const info = await page.evaluate(() => {
        // Find the properties of the webgl canvas (using our global refs if we can expose them, otherwise we just guess)
        const uiCanvas = document.querySelector('canvas');
        return {
            uiWidth: uiCanvas.width,
            uiHeight: uiCanvas.height,
            uiStyleW: uiCanvas.style.width,
            uiStyleH: uiCanvas.style.height
        };
    });
    
    console.log("UI Canvas Info:", info);
    await browser.close();
})();
