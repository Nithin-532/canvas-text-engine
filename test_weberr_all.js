import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().includes("GL_ERROR")) {
            console.log(msg.text());
        }
    });

    await page.addInitScript(() => {
        const glGetError = WebGL2RenderingContext.prototype.getError;
        
        // Wrap every function to catch the exact culprit
        for (const name in WebGL2RenderingContext.prototype) {
            try {
                if (typeof WebGL2RenderingContext.prototype[name] === 'function' && name !== 'getError') {
                    const original = WebGL2RenderingContext.prototype[name];
                    WebGL2RenderingContext.prototype[name] = function(...args) {
                        // Flush any pending errors
                        while (glGetError.call(this) !== this.NO_ERROR) {}
                        
                        const res = original.apply(this, args);
                        
                        const err = glGetError.call(this);
                        if (err !== this.NO_ERROR) {
                            console.log(`GL_ERROR exactly after ${name}: ${err}`);
                        }
                        return res;
                    };
                }
            } catch(e) {}
        }
    });

    await page.goto('http://localhost:5176/');
    await page.waitForTimeout(3000); 
    await browser.close();
})();
