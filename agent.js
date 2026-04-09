require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Import Helpers
const { log } = require('./helpers/logger');
const { askVisionAgent } = require('./helpers/vision');
const { locateInAnyFrame, injectSetOfMark, safeIsEditable } = require('./helpers/dom');
const { readMemory, writeMemory, deleteMemory, purgeAllMemory } = require('./helpers/memory'); 
const { askHuman } = require('./helpers/human');
const { getQueueFromSheet, updateSheetStatus } = require('./helpers/sheet');

// --- Configuration ---
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const isDebug = process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE';

// If NOT in DEBUG mode, wipe the screenshots directory completely
if (!isDebug) {
    if (fs.existsSync(SCREENSHOT_DIR)) fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

log("Starting Modular SAP Vision Agent...");

(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 896, height: 896 } });
    const page = await context.newPage();

    try {
        log(`Navigating to SAP URL...`, 'DEBUG', true);
        await page.goto(process.env.SAP_WEBGUI_URL, { waitUntil: 'networkidle', ignoreHTTPSErrors: true });
        
        log("Filling login credentials...");
        const userLoc = await locateInAnyFrame(page, '#sap-user');
        const passLoc = await locateInAnyFrame(page, '#sap-password');
        
        await userLoc.fill(process.env.SAP_USER);
        await passLoc.fill(process.env.SAP_PASS);
        await passLoc.press('Enter');
        await page.waitForLoadState('networkidle');
        log("Logged in successfully.");

        await page.waitForTimeout(3000); 

        const taskQueue = await getQueueFromSheet();

        for (const task of taskQueue) {
            const targetTCode = task.tcode;
            const rowIndex = task.rowIndex;
            const overwrite = task.overwrite;

            log(`\n=========================================`);
            log(`🚀 INITIATING PROCESS FOR T-CODE: ${targetTCode} (Row ${rowIndex})`);
            log(`=========================================`);

            try {
                // MANUAL OVERWRITE CHECK
                if (overwrite) {
                    log(`Manual overwrite requested via Google Sheets. Purging memory...`);
                    purgeAllMemory(targetTCode);
                }

                let skipVision = false;
                
                // PHASE 1: MEMORY
                const savedNavSelector = readMemory(targetTCode, 'navigation_field');
                let targetLocator = null;

                if (savedNavSelector) {
                    log(`🧠 Memory found for ${targetTCode} navigation! Attempting execution...`);
                    targetLocator = await locateInAnyFrame(page, savedNavSelector);
                    
                    if (targetLocator && await safeIsEditable(targetLocator)) {
                        skipVision = true;
                        log(`✅ Zero-token memory execution successful! Bypassing Vision AI.`);
                    } else {
                        log(`⚠️ Stored selector [${savedNavSelector}] failed. Triggering Self-Healing...`, 'WARN');
                        deleteMemory(targetTCode, 'navigation_field'); 
                        targetLocator = null; 
                    }
                }

                // PHASE 2: AI FALLBACK
                if (!skipVision) {
                    let screenshotPath = path.join(SCREENSHOT_DIR, 'sap_home_raw.png');
                    let imageBuffer = await page.screenshot({ path: screenshotPath });
                    
                    let prompt = `You are an SAP UI agent. We need to execute transaction code '${targetTCode}'. Identify the transaction code input field's HTML ID. Respond ONLY in JSON: {"target_box": "<html_id>", "action": "type", "text": "${targetTCode}"}`;
                    
                    let aiResponse = await askVisionAgent(prompt, imageBuffer);
                    let finalSelector = '';

                    if (aiResponse && aiResponse.target_box) {
                        finalSelector = aiResponse.target_box.includes('=') ? aiResponse.target_box : `id=${aiResponse.target_box}`;
                        targetLocator = await locateInAnyFrame(page, finalSelector);
                        if (!targetLocator || !await safeIsEditable(targetLocator)) targetLocator = null;
                    }

                    if (!targetLocator) {
                        log("Engaging Set-of-Mark (SoM) override...");
                        await injectSetOfMark(page);
                        
                        screenshotPath = path.join(SCREENSHOT_DIR, 'sap_home_som.png');
                        imageBuffer = await page.screenshot({ path: screenshotPath });
                        
                        prompt = `The SAP screen now has numbered boxes. We need to enter transaction code '${targetTCode}'. Which numbered box covers the white command input field at the top left? Respond ONLY in JSON: {"target_box": "<number>", "action": "type", "text": "${targetTCode}"}`;
                        aiResponse = await askVisionAgent(prompt, imageBuffer);
                        
                        if (aiResponse && aiResponse.target_box) {
                            finalSelector = `[data-som-id="${aiResponse.target_box}"]`;
                            targetLocator = await locateInAnyFrame(page, finalSelector);
                            if (!targetLocator || !await safeIsEditable(targetLocator)) targetLocator = null;
                        }
                    }

                    if (!targetLocator) {
                        log("🚨 AI failed. Pausing for Human-in-the-Loop.", 'WARN');
                        console.log("\n👉 Look at screenshots/sap_home_som.png and find the T-code input box number.");
                        const humanBox = await askHuman("Type the correct box number and press Enter: ");
                        
                        finalSelector = `[data-som-id="${humanBox.trim()}"]`;
                        targetLocator = await locateInAnyFrame(page, finalSelector);
                        if (!targetLocator || !await safeIsEditable(targetLocator)) throw new Error("Human-provided box is invalid.");
                    }

                    let permanentSelector = finalSelector;
                    if (finalSelector.includes('data-som-id')) {
                        const realId = await targetLocator.getAttribute('id');
                        const realTitle = await targetLocator.getAttribute('title');
                        if (realId) permanentSelector = `id=${realId}`;
                        else if (realTitle) permanentSelector = `[title="${realTitle}"]`;
                    }

                    writeMemory(targetTCode, 'navigation_field', permanentSelector);
                }

                // EXECUTE NAVIGATION
                log(`Navigating to ${targetTCode}...`);
                await targetLocator.fill(targetTCode);
                await targetLocator.press('Enter');
                await page.waitForLoadState('networkidle');

                // PHASE 3: PLUGIN
                const tcodeScriptPath = path.join(__dirname, 'tcodes', `${targetTCode.toLowerCase()}.js`);
                
                if (fs.existsSync(tcodeScriptPath)) {
                    log(`Loading application logic module for ${targetTCode}...`);
                    const runTcodeLogic = require(tcodeScriptPath);
                    
                    await runTcodeLogic(page, { 
                        log, locateInAnyFrame, SCREENSHOT_DIR, path, 
                        readMemory, writeMemory, deleteMemory, askVisionAgent, askHuman, injectSetOfMark
                    });
                } else {
                    log(`No specific logic script found for ${targetTCode}.`, 'WARN');
                }
                
                // SUCCESS
                await updateSheetStatus(rowIndex, "Complete");

            } catch (err) {
                log(`Task ${targetTCode} failed: ${err.message}`, 'ERROR');
                await updateSheetStatus(rowIndex, `Error: ${err.message}`);
                log(`Purging memory for ${targetTCode} due to error, to ensure fresh start next run.`, 'WARN');
                purgeAllMemory(targetTCode);
            }

            log("Returning to SAP Home Screen for next task...");
            const backBtn = await locateInAnyFrame(page, '[title="Back"]');
            if (backBtn) await backBtn.click();
            await page.waitForLoadState('networkidle');
        }

    } catch (e) {
        log(`Execution Crash: ${e.stack}`, 'ERROR');
    } finally {
        log("Queue processing complete. Closing browser.");
        await browser.close();
    }
})();