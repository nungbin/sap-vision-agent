const fs = require('fs');

module.exports = async function(page, helpers) {
    const { 
        log, locateInAnyFrame, askVisionForBox, askHuman, injectSetOfMark, 
        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, isTesting, tcode, taskData 
    } = helpers;

    const activeTCode = tcode.toUpperCase();
    log(`Initiating System-Wide Search for: ${activeTCode}...`);

    const usedSelectors = new Set();
    const usedBoxNumbers = new Set(); 
    let aiFailCount = 0;
    let aiCircuitBreaker = false;

    // Determine headless state
    const isHeadless = process.env.HEADLESS ? process.env.HEADLESS.toUpperCase() === 'TRUE' : true;

    await page.waitForTimeout(2000); 

    // ==========================================
    // 🚀 DYNAMIC PAYLOAD CONSUMPTION
    // ==========================================
    const formatDate = (d) => {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const y = d.getFullYear();
        return `${m}/${day}/${y}`;
    };

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    // Read the AI payload, or fallback to sensible defaults if running raw from cron
    const dateFromStr = taskData.startDate || formatDate(yesterday);
    const dateToStr = taskData.endDate || formatDate(today);
    const targetUser = taskData.userName || '*';
    const timeFromStr = "00:00:00";
    const timeToStr = "23:59:59";

    // ==========================================
    // 1. LOCATOR ENGINE
    // ==========================================
    async function getFieldLocator(memoryKey, humanDescription) {
        let selector = readSkill(activeTCode, memoryKey);
        let locator = null;

        if (selector) {
            let tempLocator = await locateInAnyFrame(page, selector);
            if (tempLocator && await tempLocator.count() > 0) {
                let isInputValid = false;
                const tagName = await tempLocator.evaluate(el => el.tagName.toLowerCase());
                
                if (tagName === 'input' || tagName === 'textarea') {
                    isInputValid = true;
                } else if (await tempLocator.locator('input').count() > 0) {
                    tempLocator = tempLocator.locator('input').first();
                    isInputValid = true;
                }

                if (isInputValid) {
                    usedSelectors.add(selector); 
                    return tempLocator; 
                } else {
                    log(`⚠️ Cached memory [${selector}] is not a valid input! Rejecting cache...`, "WARN");
                }
            }
        }

        if (isTesting) {
            throw new Error(`Strict Mode Validation Failed: Missing or invalid memory cache for '${humanDescription}'.`);
        }

        log(`Learning UI element: ${humanDescription}...`);
        await injectSetOfMark(page);

        let boxNum = null;
        
        if (!aiCircuitBreaker) {
            boxNum = await askVisionForBox(page, humanDescription, log);
            let isAiGuessValid = false;
            
            if (boxNum) {
                const cleanBox = boxNum.trim();
                
                if (usedBoxNumbers.has(cleanBox)) {
                    log(`⚠️ AI guessed Box ${cleanBox}, but we ALREADY assigned that box! Rejecting duplicate...`, "WARN");
                } else {
                    const tempSelector = `[data-som-id="${cleanBox}"]`;
                    let tempLocator = await locateInAnyFrame(page, tempSelector);
                    
                    if (tempLocator && await tempLocator.count() > 0) {
                        let actualElement = tempLocator;
                        const tagName = await tempLocator.evaluate(el => el.tagName.toLowerCase());
                        
                        if (tagName === 'input' || tagName === 'textarea') {
                            isAiGuessValid = true;
                        } else if (await tempLocator.locator('input').count() > 0) {
                            actualElement = tempLocator.locator('input').first();
                            isAiGuessValid = true;
                        }

                        if (isAiGuessValid) {
                            const realId = await actualElement.getAttribute('id');
                            const resolvedSelector = realId ? `id=${realId}` : tempSelector;

                            if (usedSelectors.has(resolvedSelector)) {
                                log(`⚠️ AI guessed Box ${cleanBox}, but its ID is ALREADY assigned to another field! Rejecting...`, "WARN");
                                isAiGuessValid = false;
                            }
                        } else {
                            log(`⚠️ AI Vision guessed Box ${cleanBox}, but it is NOT an input field! Rejecting...`, "WARN");
                        }
                    }
                }
            }
            
            if (!isAiGuessValid) {
                boxNum = null; 
                aiFailCount++;
                if (aiFailCount >= 1) {
                    log(`🛑 AI has failed ${aiFailCount} total times on this screen. Tripping Circuit Breaker.`, "WARN");
                    aiCircuitBreaker = true;
                }
            } 
            
        } else {
            log(`(AI Vision skipped due to Circuit Breaker)`);
        }
        
        if (!boxNum) {
            if (isHeadless) {
                throw new Error("Headless Mode: AI Circuit Breaker Tripped. Cannot invoke Human-in-the-Loop. Aborting task.");
            } else {
                console.log(`\n👉 Look at the popup browser window to find the box number for: ${humanDescription}`);
                boxNum = await askHuman(`Type the box number and press Enter: `);
            }
        }

        const finalBox = boxNum ? boxNum.trim() : "";
        usedBoxNumbers.add(finalBox); 

        const tempSelector = `[data-som-id="${finalBox}"]`;
        let somLocator = await locateInAnyFrame(page, tempSelector);

        if (!somLocator || await somLocator.count() === 0) {
            throw new Error(`Validation failed: Box ${finalBox} is invalid or non-interactable.`);
        }

        let isInput = await somLocator.evaluate(el => el.tagName.toLowerCase() === 'input');
        if (!isInput) {
            const innerInput = somLocator.locator('input').first();
            if (await innerInput.count() > 0) {
                somLocator = innerInput; 
            }
        }

        locator = somLocator;
        const realId = await locator.getAttribute('id');
        const permanentSelector = realId ? `id=${realId}` : tempSelector;

        writeSkill(activeTCode, memoryKey, permanentSelector);
        usedSelectors.add(permanentSelector); 

        const frames = page.frames();
        for (const frame of frames) {
            try {
                await frame.evaluate(() => {
                    const boxes = document.querySelectorAll('.som-box, div[style*="z-index: 9999"]');
                    boxes.forEach(box => box.remove());
                });
            } catch (e) {}
        }        

        return locator;
    }

    // ==========================================
    // 2. FORM EXECUTION
    // ==========================================
    log(`Setting Date Range: ${dateFromStr} to ${dateToStr}`);
    const dateFromLoc = await getFieldLocator('date_from', 'The first date input box located in the top Date row.');
    await dateFromLoc.fill(dateFromStr);
    const dateToLoc = await getFieldLocator('date_to', 'The SECOND date input box in the Date row. It is directly to the right of the first date box. Do not select the bottom input.');
    await dateToLoc.fill(dateToStr);

    log(`Setting Time Range: ${timeFromStr} to ${timeToStr}`);
    const timeFromLoc = await getFieldLocator('time_from', 'The first time input box that already contains the text 00:00:00');
    await timeFromLoc.fill(timeFromStr);
    const timeToLoc = await getFieldLocator('time_to', 'Look at the Time row. Find the SECOND input box in that row. It is under the "to" column.');
    await timeToLoc.fill(timeToStr);

    log(`Applying User Filter: [${targetUser}]`);
    const userLoc = await getFieldLocator('user_field', 'User input field');
    await userLoc.fill(targetUser);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const isDebug = process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE';
    if (isDebug && !isTesting) { 
        log("DEBUG MODE: Taking snapshot of filled form before execution...");
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${activeTCode.toLowerCase()}_form_filled_debug.png`) });
    }

    log("Executing search (Pressing F8)...");
    await page.keyboard.press('F8');
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); 

    // ==========================================
    // 3. DETERMINISTIC ZERO-RESULT CHECK
    // ==========================================
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.LOG_TIMEZONE || 'America/Edmonton',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const timestamp = formatter.format(new Date()).replace(/[^0-9]/g, '');
    const fileName = `${activeTCode}_raw_feed_${timestamp}.txt`; 
    const finalFilePath = path.join(DOWNLOAD_DIR, fileName);
    const analysisFilePath = path.join(DOWNLOAD_DIR, `${activeTCode}_analysis_${timestamp}.json`);

    log("Checking SAP Status Bar for results...");
    let zeroResultsFound = false;
    
    for (const frame of page.frames()) {
        try {
            const statusText = await frame.evaluate(() => {
                return document.body.innerText.toLowerCase();
            });
            if (statusText.includes('no short dumps') || statusText.includes('does not contain any data') || statusText.includes('no dumps found')) {
                zeroResultsFound = true;
                break;
            }
        } catch (e) {}
    }

    if (zeroResultsFound) {
        log(`ℹ️ SAP Status Bar explicitly confirmed 0 dumps. Bypassing extraction and AI processing...`);
        fs.writeFileSync(finalFilePath, "STATUS BAR CONFIRMED 0 DUMPS FOR THIS DATE RANGE.");
        log(`✅ LEAN STRUCTURED FEED SAVED: ${fileName}`);
        
        const zeroDumpJson = { dumpsFound: false, count: 0, dumps: [] };
        fs.writeFileSync(analysisFilePath, JSON.stringify(zeroDumpJson, null, 2));
        log(`✅ AI JSON Analysis saved to: ${analysisFilePath}`);
        
        log(`[GATEWAY_SUMMARY]: 🟢 **ST22 Status:** System is clean. 0 short dumps found for user ${targetUser}.`);
        
        return "0 short dumps found."; 
    }

    // ==========================================
    // 4. OMNI-EXTRACTOR
    // ==========================================
    log("Extracting and PRE-FILTERING data for speed...");
    let rawTextFeed = "";

    for (const frame of page.frames()) {
        try {
            const frameData = await frame.evaluate(() => {
                let allText = document.body.innerText || "";
                const inputNodes = document.querySelectorAll('input');
                const inputValues = Array.from(inputNodes).map(i => i.value).filter(v => v && v.trim().length > 0);
                if (inputValues.length > 0) {
                    allText += "\n" + inputValues.join('\n');
                }

                const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 1);
                
                let groupedOutput = [];
                let currentRow = [];
                
                for (const line of lines) {
                    if (/\d{2}\/\d{2}\/\d{4}/.test(line)) {
                        if (currentRow.length > 0) groupedOutput.push(currentRow.join(' | '));
                        currentRow = [line];
                    } else if (currentRow.length > 0) {
                        currentRow.push(line);
                    }
                }
                
                if (currentRow.length > 0) groupedOutput.push(currentRow.join(' | '));
                return groupedOutput.join('\n');
            });
            
            if (frameData) rawTextFeed += "\n" + frameData;
        } catch (e) {}
    }

    fs.writeFileSync(finalFilePath, rawTextFeed);
    log(`✅ LEAN STRUCTURED FEED SAVED: ${fileName}`);

    // ==========================================
    // 5. SKILL.MD INJECTION & AI PARSING
    // ==========================================
    const skillDirPath = path.join(__dirname, '..', '..', 'skills', activeTCode);
    const skillMdPath = path.join(skillDirPath, 'skill.md');

    if (!isTesting && !fs.existsSync(skillMdPath)) {
        log(`Creating default skill.md for ${activeTCode}...`);
        if (!fs.existsSync(skillDirPath)) fs.mkdirSync(skillDirPath, { recursive: true });
        const defaultMarkdown = `# DESCRIPTION\nAnalyzes raw SAP ST22 (Short Dump) text feeds...\n\n# PROMPT\n... (see previous file for full markdown text) ...\n\n# RAW DATA\n{{RAW_SAP_DATA}}`;
        fs.writeFileSync(skillMdPath, defaultMarkdown);
    }

    log(`Reading AI instructions from skill.md...`);
    const markdownTemplate = fs.readFileSync(skillMdPath, 'utf8');
    const finalPrompt = markdownTemplate.replace('{{RAW_SAP_DATA}}', `"""\n${rawTextFeed}\n"""`);

    try {
        // We ensure this internal API call still uses /api/generate since we aren't chatting here, just parsing a document!
        const generateUrl = process.env.OLLAMA_URL.replace('/api/chat', '/api/generate');

        const response = await fetch(generateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL || "gemma",
                prompt: finalPrompt,
                format: "json",
                stream: false,
                options: { num_ctx: 4096, top_k: 20, top_p: 0.5, temperature: 0 }
            })
        });
        
        if (!response.ok) throw new Error(`Ollama API returned status: ${response.status}`);
        
        const data = await response.json();
        const aiAnalysisObj = JSON.parse(data.response.trim());
        
        console.log(`\n======================================================`);
        console.log(`🧠 AI BRAIN ANALYSIS (JSON)`);
        console.log(`======================================================`);
        console.log(JSON.stringify(aiAnalysisObj, null, 2)); 
        console.log(`======================================================\n`);
        
        fs.writeFileSync(analysisFilePath, JSON.stringify(aiAnalysisObj, null, 2));
        log(`✅ AI JSON Analysis saved to: ${analysisFilePath}`);
        
        if (aiAnalysisObj.count > 0) {
            log(`[GATEWAY_ARTIFACT]: ${analysisFilePath}`);
        } else {
            log(`ℹ️ 0 dumps found. Skipping artifact upload to Telegram.`);
        }

        let summaryText = "";
        if (aiAnalysisObj.count === 0) {
            summaryText = `🟢 **ST22 Status:** System is clean. 0 short dumps found for user ${targetUser}.`;
        } else {
            summaryText = `🚨 **ST22 Alert: ${aiAnalysisObj.count} Dump(s) Found**\\n\\n`;
            if (Array.isArray(aiAnalysisObj.dumps)) {
                const topDumps = aiAnalysisObj.dumps.slice(0, 3);
                topDumps.forEach(dump => {
                    const err = dump.runtimeError || dump.error || dump.exception || dump.category || dump.type || "Unknown Error";
                    const contextInfo = dump.program || dump.programName || dump.user || "System";
                    
                    const dumpDate = dump.date || dump.dumpDate || "?";
                    const dumpTime = dump.time || dump.dumpTime || "?";
                    
                    summaryText += `• [${dumpDate} ${dumpTime}] ${err} (${contextInfo})\\n`;
                });                
                if (aiAnalysisObj.count > 3) {
                    summaryText += `\\n*(+ ${aiAnalysisObj.count - 3} more. See attached artifact for full details.)*`;
                }
            }
        }

        log(`[GATEWAY_SUMMARY]: ${summaryText}`);

        return `${aiAnalysisObj.count} short dump(s) found.`; 

    } catch (error) {
        log(`⚠️ AI Brain Analysis failed: ${error.message}`, "WARN");
        throw error; 
    }
};