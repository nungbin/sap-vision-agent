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
const isHeadless = process.env.HEADLESS ? process.env.HEADLESS.toUpperCase() === 'TRUE' : true;

if (!isDebug && fs.existsSync(SCREENSHOT_DIR)) {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ==========================================
// NEW: TASK.MD CONFIGURATION PARSER
// ==========================================
function parseTaskConfig(taskName) {
    const mdPath = path.join(__dirname, 'tasks', taskName, 'task.md');
    if (!fs.existsSync(mdPath)) {
        throw new Error(`Missing task.md file at: ${mdPath}`);
    }

    const content = fs.readFileSync(mdPath, 'utf8');
    const config = { target: '', type: '', payload: {} };

    // Extract TARGET
    const targetMatch = content.match(/#\s*TARGET\n+([^\n]+)/i);
    if (targetMatch) config.target = targetMatch[1].trim();

    // Extract TYPE
    const typeMatch = content.match(/#\s*TYPE\n+([^\n]+)/i);
    if (typeMatch) config.type = typeMatch[1].trim();

    // Extract PAYLOAD (Handles default values with '=')
    const payloadMatch = content.match(/#\s*PAYLOAD\n+([\s\S]*?)(?:\n#|$)/i);
    if (payloadMatch) {
        const lines = payloadMatch[1].split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line === 'NONE' || !line.startsWith('-')) continue;
            
            line = line.replace(/^-/, '').trim(); 
            const splitIdx = line.indexOf('=');
            if (splitIdx !== -1) {
                const key = line.substring(0, splitIdx).trim();
                const val = line.substring(splitIdx + 1).trim();
                config.payload[key] = val;
            } else if (line.length > 0) {
                config.payload[line] = "";
            }
        }
    }
    return config;
}

async function run() {
    log("==================================================");
    log("🤖 SAP VISION AGENT: FSM ORCHESTRATOR INITIALIZING");
    log(`⚙️  MODE: ${isHeadless ? 'HEADLESS (Cloud/Cron)' : 'INTERACTIVE (Local/GUI)'}`);
    log("==================================================");

    // ==========================================
    // DUAL-ENGINE QUEUE BUILDER
    // ==========================================
    let queue = [];
    let isCliRun = false;
    const cliTask = process.argv[2]; // e.g., "node agent.js ui5_wizard"

    if (cliTask) {
        log(`⚡ EVENT ENGINE TRIGGERED: Bypassing Google Sheets for isolated run: [${cliTask.toUpperCase()}]`);
        isCliRun = true;
        try {
            const config = parseTaskConfig(cliTask);
            
            // Build a "Mock" Mega-Sheet Row in memory!
            const mockTask = {
                taskName: cliTask,
                tcode: config.type === 'TCODE' ? config.target : cliTask,
                target: config.target,
                skillState: 'Production', // Default entry point for standalone requests
                rowIndex: -1,
                ...config.payload // Spreads the task.md variables (e.g. productType) into the object
            };
            queue.push(mockTask);
        } catch (e) {
            log(`❌ Failed to parse task.md for ${cliTask}: ${e.message}`, "ERROR");
            return;
        }
    } else {
        log(`📊 BATCH ENGINE TRIGGERED: Fetching queue from Google Mega-Sheet...`);
        queue = await getQueue(process.env.GOOGLE_SHEET_ID);
        if (queue.length === 0) {
            log("No Tasks found in the execution queue.");
            return;
        }
    }

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
        const scriptName = (task.taskName || task.tcode).toLowerCase();
        log(`\n▶️ Processing: [${scriptName.toUpperCase()}]`);
        
        let currentState = task.skillState;
        let cycleComplete = false;

        let targetUrl = '';
        if (task.target && task.target.toLowerCase().startsWith('http')) {
            targetUrl = task.target;
        } else {
            const tcodeTarget = task.target || task.tcode || task.taskName;
            targetUrl = `${process.env.SAP_WEBGUI_URL}&~transaction=${tcodeTarget}`;
        }

        while (!cycleComplete) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: process.env.LOG_TIMEZONE });
            
            // 🟢 UPDATED PATH: Injecting scriptName twice to access the sub-folder
            const scriptPath = path.join(__dirname, 'tasks', scriptName, `${scriptName}.js`);

            if (currentState === 'Needs Training' || currentState === 'Broken') {
                log(`[FSM STATE: ${currentState.toUpperCase()}] Initiating Targeted AI/Human Training...`);
                purgeSkill(scriptName); 

                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const executeTask = require(scriptPath);
                    const runMessage = await executeTask(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: false, 
                        tcode: task.tcode || task.taskName,
                        scriptName: scriptName,             
                        taskData: task                      
                    });

                    log(`✅ Training Complete for ${scriptName.toUpperCase()}. Updating checkpoint to TESTING.`);
                    currentState = 'Testing';
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Training complete. Pending unit test.', timestamp);
                } catch (error) {
                    log(`❌ Training Failed for ${scriptName.toUpperCase()}: ${error.message}`, "ERROR");
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', error.message, timestamp);
                    cycleComplete = true; 
                }
            } 
            
            else if (currentState === 'Testing') {
                log(`[FSM STATE: TESTING] Executing strict autonomous unit test...`);
                
                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const executeTask = require(scriptPath);
                    const runMessage = await executeTask(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: true, 
                        tcode: task.tcode || task.taskName, 
                        scriptName: scriptName, 
                        taskData: task 
                    });

                    log(`🎉 Validation Passed! Promoting ${scriptName.toUpperCase()} to PRODUCTION.`);
                    currentState = 'Production';
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Complete', timestamp);
                    cycleComplete = true; 
                } catch (error) {
                    log(`❌ Unit Test Failed for ${scriptName.toUpperCase()}: ${error.message}`, "ERROR");
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', `Validation Failed: ${error.message}`, timestamp);
                    cycleComplete = true; 
                }
            }

            else if (currentState === 'Production') {
                log(`[FSM STATE: PRODUCTION] Executing silent autonomous run...`);
                
                try {
                    await page.goto(targetUrl);
                    await page.waitForLoadState('networkidle');

                    const executeTask = require(scriptPath);
                    const runMessage = await executeTask(page, { 
                        log, locateInAnyFrame, askHuman, askVisionForBox, injectSetOfMark, 
                        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, 
                        isTesting: false, 
                        tcode: task.tcode || task.taskName, 
                        scriptName: scriptName, 
                        taskData: task 
                    });

                    log(`✅ Production Run Complete for ${scriptName.toUpperCase()}.`);
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, currentState, runMessage || 'Complete', timestamp);
                    
                    // If CLI run, we want to broadcast the final result out to the console so the Gateway can catch it!
                    if (isCliRun) log(`[GATEWAY_RESPONSE]: ${runMessage || 'Success'}`);
                    
                    cycleComplete = true;
                } catch (error) {
                    log(`💥 Production Run Crashed for ${scriptName.toUpperCase()}. Self-healing triggered.`, "ERROR");
                    if (!isCliRun) await updateRowStatus(process.env.GOOGLE_SHEET_ID, task.rowIndex, 'Broken', `Crashed: ${error.message}`, timestamp);
                    
                    if (isCliRun) {
                        log(`[GATEWAY_RESPONSE]: Crashed - ${error.message}`, "ERROR");
                    } else {
                        // Only loop back to training locally if we are running in the batch FSM loop
                        currentState = 'Needs Training';
                    }
                    cycleComplete = true; 
                }
            }
            
            else {
                 log(`⚠️ Unknown State: ${currentState}. Defaulting to Needs Training.`, "WARN");
                 currentState = 'Needs Training';
            }
        }
    }

    log("Queue processing complete. Executing graceful SAP logoff...");
    try {
        // The ~transaction=logoff parameter tells the ITS to instantly destroy the session
        const logoffUrl = process.env.SAP_WEBGUI_URL.split('?')[0] + '?~transaction=logoff';
        await page.goto(logoffUrl, { waitUntil: 'networkidle', timeout: 10000 });
        log("✅ ITS Session memory cleared.");
    } catch (e) {
        log(`⚠️ Graceful logoff failed or timed out: ${e.message}`, "WARN");
    }

    log("Closing browser.");
    await browser.close();
}

run().catch(console.error);