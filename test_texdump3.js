import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));
    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(5000); 
    // Print all logs
    for (const l of logs) {
        if (l.length < 500) console.log(l);
    }
    await browser.close();
})();
