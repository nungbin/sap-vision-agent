const { log } = require('./logger');

async function locateInAnyFrame(page, selector) {
    for (const frame of page.frames()) {
        const loc = frame.locator(selector);
        if (await loc.count() > 0) return loc.first();
    }
    return null;
}

async function injectSetOfMark(page) {
    log("Injecting Set-of-Mark (SoM) boxes into DOM...");
    await page.evaluate(() => {
        let counter = 1;
        let targetDoc = document;
        const frames = document.querySelectorAll('iframe');
        if (frames.length > 0) targetDoc = frames[0].contentDocument || frames[0].contentWindow.document;

        targetDoc.querySelectorAll('input, button, a, [role="button"], .lsButton, .urBtn').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10 || rect.top < 0) return; 
            
            const overlay = targetDoc.createElement('div');
            overlay.className = 'som-box';
            overlay.style.position = 'absolute';
            overlay.style.left = (rect.left + targetDoc.defaultView.scrollX) + 'px';
            overlay.style.top = (rect.top + targetDoc.defaultView.scrollY) + 'px';
            overlay.style.border = '2px solid red';
            overlay.style.backgroundColor = 'yellow';
            overlay.style.color = 'black';
            overlay.style.fontWeight = 'bold';
            overlay.style.fontSize = '18px';
            overlay.style.zIndex = 999999;
            overlay.innerText = counter;
            
            el.setAttribute('data-som-id', counter);
            targetDoc.body.appendChild(overlay);
            counter++;
        });
    });
}

// FIX: Safely check if an element is editable without crashing Playwright
async function safeIsEditable(locator) {
    try {
        return await locator.isEditable();
    } catch (e) {
        // If Playwright throws an error (e.g., "Element is not an <input>"), it's not editable.
        return false; 
    }
}

module.exports = { locateInAnyFrame, injectSetOfMark, safeIsEditable };