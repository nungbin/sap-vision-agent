module.exports = async function processST22(page, helpers) {
    const { log, locateInAnyFrame, SCREENSHOT_DIR, path } = helpers;

    log("Navigation complete. Capturing ST22 screen...");
    await page.waitForTimeout(2000); // Give SAP a moment to render
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'st22_loaded_raw.png') });

    log("Checking for short dumps...");
    const bodyLocator = await locateInAnyFrame(page, 'body');
    // Using textContent instead of innerText often helps with weird SAP table formatting
    const pageText = bodyLocator ? await bodyLocator.textContent() : "";
    
    // FIX 1: Ultra-forgiving Regex
    // This allows for up to 50 characters of weird SAP formatting/newlines between the words
    if (pageText.match(/Today[\s\S]{1,200}?0[\s\S]{1,200}?Runtime Errors/i)) {
        log("🟢 Status: 0 Runtime Errors found for Today. All clear!");
    } else {
        log("🔴 Runtime Errors detected (or 0 not found)! Attempting to list them...", 'WARN');
        
        const actionButton = await locateInAnyFrame(page, 'div[role="button"]:has-text("Today"), button:has-text("Today"), span:has-text("Today")');
        
        if (actionButton) {
            log("Found the button. Scrolling into view...");
            await actionButton.scrollIntoViewIfNeeded(); 
            
            log("Clicking to load dump list...");
            // FIX 2: Force the click to punch through SAP's invisible div overlays
            await actionButton.click({ force: true });
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000); 
            
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dump_list_result.png') });
            log("📸 Dump list loaded and screenshot saved.");
        } else {
            log("Could not find the button to list dumps.", 'ERROR');
        }
    }
};