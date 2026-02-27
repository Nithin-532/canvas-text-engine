import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().includes("GL_ERROR") || msg.text().includes("GLYPH_DEBUG")) {
            console.log(msg.text());
        }
    });

    await page.addInitScript(() => {
        const _drawArraysInstanced = WebGL2RenderingContext.prototype.drawArraysInstanced;
        WebGL2RenderingContext.prototype.drawArraysInstanced = function(...args) {
            _drawArraysInstanced.apply(this, args);
            const err = this.getError();
            if (err !== this.NO_ERROR) {
                console.log("GL_ERROR after drawArraysInstanced:", err);
            }
        };
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(3000); 
    await browser.close();
})();
