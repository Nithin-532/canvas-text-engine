import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().includes("GL_ERROR") || msg.text().includes("VAO_DUMP")) {
            console.log(msg.text());
        }
    });

    await page.addInitScript(() => {
        const _drawArraysInstanced = WebGL2RenderingContext.prototype.drawArraysInstanced;
        WebGL2RenderingContext.prototype.drawArraysInstanced = function(...args) {
            
            for (let i = 0; i <= 4; i++) {
                const buf = this.getVertexAttrib(i, this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
                if (!buf) {
                    console.log("VAO_DUMP missing buffer passing for attrib", i);
                    continue;
                }
                const currentBuf = this.getParameter(this.ARRAY_BUFFER_BINDING);
                this.bindBuffer(this.ARRAY_BUFFER, buf);
                const size = this.getBufferParameter(this.ARRAY_BUFFER, this.BUFFER_SIZE);
                this.bindBuffer(this.ARRAY_BUFFER, currentBuf);
                
                const enabled = this.getVertexAttrib(i, this.VERTEX_ATTRIB_ARRAY_ENABLED);
                const divisor = this.getVertexAttrib(i, this.VERTEX_ATTRIB_ARRAY_DIVISOR);
                const stride = this.getVertexAttrib(i, this.VERTEX_ATTRIB_ARRAY_STRIDE);
                console.log(`VAO_DUMP attrib ${i}: en=${enabled}, div=${divisor}, stride=${stride}, bufSize=${size}`);
            }

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
