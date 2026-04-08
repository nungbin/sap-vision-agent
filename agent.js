require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Import Helpers
const { log } = require('./helpers/logger');
const { askVisionAgent } = require('./helpers/vision');
const { locateInAnyFrame, injectSetOfMark, safeIsEditable } = require('./helpers/dom');
const { generateSkillScript } = require('./helpers/skills');
const { askHuman } = require('./helpers/human');

// --- Configuration ---
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const SKILLS_DIR = path.join(__dirname, 'skills');
if (fs.existsSync(SCREENSHOT_DIR)) fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TARGET_TCODE = "ST22"; 

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

        // ==========================================
        // PHASE 1: SKILL EXECUTION & SELF-HEALING
        // ==========================================
        let skipVision = false;
        const skillPath = path.join(SKILLS_DIR, `skill_${TARGET_TCODE.toLowerCase()}.js`);
        
        if (fs.existsSync(skillPath)) {
            log(`🧠 Learned skill found for ${TARGET_TCODE}! Attempting execution...`);
            try {
                const executeSkill = require(skillPath);
                await executeSkill(page);
                await page.waitForLoadState('networkidle');
                skipVision = true;
                log(`✅ Skill executed successfully! Bypassing Vision AI.`);
            } catch (err) {
                log(`⚠️ Skill failed (SAP UI may have changed). Deleting broken skill and triggering re-learning...`, 'WARN');
                fs.unlinkSync(skillPath); // Delete the broken skill
                skipVision = false;       // Fall back to Vision AI
            }
        }

        // ==========================================
        // PHASE 2: VISION AI FALLBACK (If no skill)
        // ==========================================
        if (!skipVision) {
            let screenshotPath = path.join(SCREENSHOT_DIR, 'sap_home_raw.png');
            let imageBuffer = await page.screenshot({ path: screenshotPath });
            
            let prompt = `You are an SAP UI agent. We need to execute transaction code '${TARGET_TCODE}'. Identify the transaction code input field's HTML ID. Respond ONLY in JSON: {"target_box": "<html_id>", "action": "type", "text": "${TARGET_TCODE}"}`;
            
            let aiResponse = await askVisionAgent(prompt, imageBuffer);
            let targetLocator = null;
            let finalSelector = '';

            // 1. Raw Vision Verification
            if (aiResponse && aiResponse.target_box) {
                finalSelector = aiResponse.target_box.includes('=') ? aiResponse.target_box : `id=${aiResponse.target_box}`;
                targetLocator = await locateInAnyFrame(page, finalSelector);
                
                if (!targetLocator) {
                    log(`Raw vision guessed ID '${aiResponse.target_box}', but it doesn't exist.`, 'WARN');
                } else if (!await safeIsEditable(targetLocator)) {
                    log(`Raw vision guessed ID '${aiResponse.target_box}', but it is not an editable text field. Rejecting.`, 'WARN');
                    targetLocator = null;
                }
            }

            // 2. Set-of-Mark Fallback
            if (!targetLocator) {
                log("Engaging Set-of-Mark (SoM) override...");
                await injectSetOfMark(page);
                
                screenshotPath = path.join(SCREENSHOT_DIR, 'sap_home_som.png');
                imageBuffer = await page.screenshot({ path: screenshotPath });
                
                prompt = `The SAP screen now has numbered boxes. We need to enter transaction code '${TARGET_TCODE}'. Which numbered box covers the white command input field at the top left? Respond ONLY in JSON: {"target_box": "<number>", "action": "type", "text": "${TARGET_TCODE}"}`;
                aiResponse = await askVisionAgent(prompt, imageBuffer);
                
                if (aiResponse && aiResponse.target_box) {
                    finalSelector = `[data-som-id="${aiResponse.target_box}"]`;
                    targetLocator = await locateInAnyFrame(page, finalSelector);
                    
                    if (!targetLocator) {
                        log(`SoM vision guessed Box [${aiResponse.target_box}], but it doesn't exist.`, 'WARN');
                    } else if (!await safeIsEditable(targetLocator)) {
                        log(`SoM vision guessed Box [${aiResponse.target_box}], but it is a button. Rejecting.`, 'WARN');
                        targetLocator = null; 
                    }
                }
            }

            // 3. Human-in-the-Loop (HITL)
            if (!targetLocator) {
                log("🚨 AI failed to find a valid input field. Pausing for Human-in-the-Loop.", 'WARN');
                console.log("\n👉 Look at screenshots/sap_home_som.png and find the T-code input box number.");
                const humanBox = await askHuman("Type the correct box number and press Enter: ");
                
                finalSelector = `[data-som-id="${humanBox.trim()}"]`;
                targetLocator = await locateInAnyFrame(page, finalSelector);
                if (!targetLocator) throw new Error("Human-provided box couldn't be found.");
                if (!await safeIsEditable(targetLocator)) throw new Error("Human-provided box is not editable.");
            }

            // --- Selector Translation (Fixing the Ephemeral ID bug) ---
            let permanentSelector = finalSelector;
            if (finalSelector.includes('data-som-id')) {
                const realId = await targetLocator.getAttribute('id');
                const realTitle = await targetLocator.getAttribute('title');
                if (realId) permanentSelector = `id=${realId}`;
                else if (realTitle) permanentSelector = `[title="${realTitle}"]`;
            }

            log(`Executing learned navigation to ${TARGET_TCODE}...`);
            await targetLocator.fill(TARGET_TCODE);
            await targetLocator.press('Enter');
            await page.waitForLoadState('networkidle');
            
            // Save the permanent selector, not the temporary SoM ID!
            generateSkillScript(TARGET_TCODE, permanentSelector);
        }

        // ==========================================
        // PHASE 3: DYNAMIC MODULE LOADER
        // ==========================================
        const tcodeScriptPath = path.join(__dirname, 'tcodes', `${TARGET_TCODE.toLowerCase()}.js`);
        
        if (fs.existsSync(tcodeScriptPath)) {
            log(`Loading application logic module for ${TARGET_TCODE}...`);
            const runTcodeLogic = require(tcodeScriptPath);
            await runTcodeLogic(page, { log, locateInAnyFrame, SCREENSHOT_DIR, path });
        } else {
            log(`No specific logic script found for ${TARGET_TCODE}. Ending task.`, 'WARN');
        }

    } catch (e) {
        log(`Execution Crash: ${e.stack}`, 'ERROR');
    } finally {
        log("Task complete. Closing browser.");
        await browser.close();
    }
})();