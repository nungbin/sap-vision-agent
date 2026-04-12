require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { log } = require('./helpers/logger');
const { getQueue, updateRowStatus } = require('./helpers/sheet');
const { readSkill, writeSkill, purgeSkill } = require('./helpers/skill'); 
const { locateInAnyFrame, injectSetOfMark } = require('./helpers/dom');
const { askHuman } = require('./helpers/human');
const { askVisionForBox } = require('./helpers/vision');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

const isDebug = process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE';

// Determine Headless state. Default to true for cloud/cron, allow override via .env
const isHeadless = process.env.HEADLESS ? process.env.HEADLESS.toUpperCase() === 'TRUE' : true;

// Auto-wipe old screenshots on startup if NOT in debug mode
if (!isDebug && fs.existsSync(SCREENSHOT_DIR)) {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function run() {
    log("==================================================");
    log("🤖 SAP VISION AGENT: FSM ORCHESTRATOR INITIALIZING");
    log(`⚙️  MODE: ${isHeadless ? 'HEADLESS (Cloud/Cron)' : 'INTERACTIVE (Local/GUI)'}`);
    log("==================================================");

    const queue = await getQueue(process.env.GOOGLE_SHEET_ID);
    if (queue.length === 0) {
        log("No Tasks found in the execution queue.");
        return;
    }

    // 🟢 HEADLESS & CONTAINER SAFE LAUNCH ARGS
    const browser = await chromium.launch({ 
        headless: isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({ viewport: { width: 896, height: 896 } });
    const page = await context.newPage();

    log("Logging into SAP WebGUI...");
    await page.goto(process.env.SAP_WEBGUI_URL);
    await page.locator('#sap-user').fill(process.env.SAP_USER);
    await page.locator('#sap-password').fill(process.env.SAP_PASS);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');

    for (const task of queue) {
        // Support both legacy T-Codes and modern UI5 scripts
        const scriptName = (task.taskName || task.tcode).toLowerCase();
        log(`\n▶️ Processing Row ${task.rowIndex}: [${scriptName.toUpperCase()}]`);
        
        let currentState = task.skillState;
        let cycleComplete = false;

        // ==========================================
        // DYNAMIC URL ROUTING LOGIC
        // ==========================================
        let targetUrl = '';
        if (task.target && task.target.toLowerCase().startsWith('http')) {
            // Modern UI5 URL
            targetUrl = task.target;
        } else {
            // Legacy T-Code (Fallback to taskName if target is somehow blank)
            const tcodeTarget = task.target || task.tcode || task.taskName;
            targetUrl = `${process.env.SAP_WEBGUI_URL}&~transaction=${tcodeTarget}`;
        }

        while (!cycleComplete) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: process.env.LOG_TIMEZONE });

            if (currentState === 'Needs Training' || currentState === 'Broken') {
                log(`[FSM STATE: ${currentState.toUpperCase()}] Initiating Targeted AI/Human Training...`);
                purgeSkill(scriptName); 

                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const scriptPath = path.join(__dirname, 'tasks', `${scriptName}.js`);
                    const executeTCode = require(scriptPath);
                    
                    // 🟢 Inject BOTH legacy 'tcode' and modern 'taskData'/'scriptName'
                    const runMessage = await executeTCode(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: false, 
                        tcode: task.tcode || task.taskName, // Preserved for legacy ST22
                        scriptName: scriptName,             // New for UI5
                        taskData: task                      // The full Mega-Sheet row payload!
                    });

                    log(`✅ Training Complete for ${scriptName.toUpperCase()}. Updating checkpoint to TESTING.`);
                    currentState = 'Testing';
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Training complete. Pending unit test.', timestamp);
                } catch (error) {
                    log(`❌ Training Failed for ${scriptName.toUpperCase()}: ${error.message}`, "ERROR");
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', error.message, timestamp);
                    cycleComplete = true; 
                }
            } 
            
            else if (currentState === 'Testing') {
                log(`[FSM STATE: TESTING] Executing strict autonomous unit test...`);
                
                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const scriptPath = path.join(__dirname, 'tasks', `${scriptName}.js`);
                    const executeTCode = require(scriptPath);
                    
                    const runMessage = await executeTCode(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: true, 
                        tcode: task.tcode || task.taskName, 
                        scriptName: scriptName, 
                        taskData: task 
                    });

                    log(`🎉 Validation Passed! Promoting ${scriptName.toUpperCase()} to PRODUCTION.`);
                    currentState = 'Production';
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Complete', timestamp);
                    cycleComplete = true; 
                } catch (error) {
                    log(`❌ Unit Test Failed for ${scriptName.toUpperCase()}: ${error.message}`, "ERROR");
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', `Validation Failed: ${error.message}`, timestamp);
                    cycleComplete = true; 
                }
            }

            else if (currentState === 'Production') {
                log(`[FSM STATE: PRODUCTION] Executing silent autonomous run...`);
                
                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const scriptPath = path.join(__dirname, 'tasks', `${scriptName}.js`);
                    const executeTCode = require(scriptPath);
                    
                    const runMessage = await executeTCode(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: false, 
                        tcode: task.tcode || task.taskName, 
                        scriptName: scriptName, 
                        taskData: task 
                    });

                    log(`✅ Production Run Complete for ${scriptName.toUpperCase()}.`);
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Complete', timestamp);
                    cycleComplete = true;
                } catch (error) {
                    log(`💥 Production Run Crashed for ${scriptName.toUpperCase()}. Self-healing triggered.`, "ERROR");
                    await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', `Crashed: ${error.message}`, timestamp);
                    cycleComplete = true; 
                }
            }
            
            else {
                 log(`⚠️ Unknown State: ${currentState}. Defaulting to Needs Training.`, "WARN");
                 currentState = 'Needs Training';
            }
        }
    }

    log("Queue processing complete. Closing browser.");
    await browser.close();
}

run().catch(console.error);