import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); 
    
    const data = await page.evaluate(() => {
        const canvases = document.querySelectorAll('canvas');
        return {
            gl: canvases[0].toDataURL(),
            ui: canvases[1].toDataURL()
        };
    });
    
    fs.writeFileSync('/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/gl_canvas.png', data.gl.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync('/home/nithinsai/.gemini/antigravity/brain/88246646-0ef5-4c05-bb00-219d63bd5f40/ui_canvas.png', data.ui.replace(/^data:image\/png;base64,/, ''), 'base64');
    
    console.log('Saved canvases.');
    await browser.close();
})();
