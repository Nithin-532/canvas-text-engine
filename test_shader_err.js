import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        console.log(msg.text());
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(3000); 
    await browser.close();
})();
