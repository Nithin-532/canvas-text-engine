import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(5000); // let it load
    
    const info = await page.evaluate(() => {
        const canvases = document.querySelectorAll('canvas');
        if (canvases.length < 2) return { error: "Not enough canvases" };
        
        const glCanvas = canvases[0];
        const uiCanvas = canvases[1];
        const wrapper = glCanvas.parentElement;
        
        return {
            wrapperBg: window.getComputedStyle(wrapper).backgroundColor,
            wrapperStyle: wrapper.style.cssText,
            glDisplay: window.getComputedStyle(glCanvas).display,
            uiDisplay: window.getComputedStyle(uiCanvas).display,
            glOpacity: window.getComputedStyle(glCanvas).opacity,
            uiOpacity: window.getComputedStyle(uiCanvas).opacity,
            glData: glCanvas.toDataURL().substring(0, 50),
            uiData: uiCanvas.toDataURL().substring(0, 50)
        };
    });
    
    console.log(JSON.stringify(info, null, 2));
    await browser.close();
})();
