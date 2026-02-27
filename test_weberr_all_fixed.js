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
        
        const props = Object.getOwnPropertyNames(WebGL2RenderingContext.prototype);
        for (const name of props) {
            try {
                if (typeof WebGL2RenderingContext.prototype[name] === 'function' && name !== 'getError') {
                    const original = WebGL2RenderingContext.prototype[name];
                    WebGL2RenderingContext.prototype[name] = function(...args) {
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
