module.exports = async function(page, helpers) {
    const { log, locateInAnyFrame, SCREENSHOT_DIR, path, readMemory, writeMemory, askVisionAgent, askHuman, injectSetOfMark } = helpers;

    const TCODE = "ST22";
    log("Initiating System-Wide Short Dump Analysis...");

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); 

    // ==========================================
    // 1. DYNAMIC DATE CALCULATION
    // ==========================================
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const formatDate = (d) => {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const y = d.getFullYear();
        return `${m}/${day}/${y}`;
    };

    const dateFromStr = formatDate(yesterday);
    const dateToStr = formatDate(today);
    const timeFromStr = "00:00:00";
    const timeToStr = "23:59:59";

    // ==========================================
    // 2. MINI-AGENT: FIELD DISCOVERY & CACHING
    // ==========================================
    async function getFieldLocator(memoryKey, humanDescription) {
        let selector = readMemory(TCODE, memoryKey);
        let locator = null;

        if (selector) {
            locator = await locateInAnyFrame(page, selector);
            if (locator && await locator.count() > 0) return locator;
        }

        log(`Learning UI element: ${humanDescription}...`);
        await injectSetOfMark(page);
        
        console.log(`\n👉 Look at the popup browser window to find the box number for: ${humanDescription}`);
        const boxNum = await askHuman(`Type the box number and press Enter: `);

        const tempSelector = `[data-som-id="${boxNum.trim()}"]`;
        let somLocator = await locateInAnyFrame(page, tempSelector);

        if (!somLocator) throw new Error(`Could not locate ${humanDescription}`);

        // 🟢 SAP WEBGUI FIX: Dive into the wrapper to find the actual <input> tag
        let isInput = await somLocator.evaluate(el => el.tagName.toLowerCase() === 'input');
        if (!isInput) {
            const innerInput = somLocator.locator('input').first();
            if (await innerInput.count() > 0) {
                somLocator = innerInput; // Swap to the actual input field
            }
        }

        locator = somLocator;
        const realId = await locator.getAttribute('id');
        
        // Ensure we explicitly target the unique ID
        const permanentSelector = realId ? `id=${realId}` : tempSelector;

        writeMemory(TCODE, memoryKey, permanentSelector);

        await page.evaluate(() => {
            const boxes = document.querySelectorAll('div[style*="z-index: 9999"]');
            boxes.forEach(box => box.remove());
        });

        return locator;
    }

    // ==========================================
    // 3. FILLING THE FORM
    // ==========================================
    log(`Setting Date Range: ${dateFromStr} to ${dateToStr}`);
    const dateFromLoc = await getFieldLocator('date_from', 'Date from (the first date box)');
    await dateFromLoc.fill(dateFromStr);

    const dateToLoc = await getFieldLocator('date_to', 'Date to (the second date box)');
    await dateToLoc.fill(dateToStr);

    log(`Setting Time Range: ${timeFromStr} to ${timeToStr}`);
    const timeFromLoc = await getFieldLocator('time_from', 'Time from (the first time box)');
    await timeFromLoc.fill(timeFromStr);

    const timeToLoc = await getFieldLocator('time_to', 'Time to (the second time box)');
    await timeToLoc.fill(timeToStr);

    log(`Clearing User field for system-wide search...`);
    const userLoc = await getFieldLocator('user_field', 'User input field');
    
    // 🟢 SAP WEBGUI FIX: Use the SAP wildcard '*' for all users, then Tab away to trigger the UI update
    await userLoc.fill('*');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // ==========================================
    // 4. EXECUTION
    // ==========================================
    const isDebug = process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE';
    if (isDebug) {
        log("DEBUG MODE: Taking snapshot of filled form before execution...");
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'st22_form_filled_debug.png') });
    }

    log("Executing search (Pressing F8)...");
    await page.keyboard.press('F8');
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); 

    log("Form execution complete. Ready for Dump List extraction phase!");
};