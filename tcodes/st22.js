const fs = require('fs');

module.exports = async function(page, helpers) {
    const { 
        log, locateInAnyFrame, askVisionForBox, askHuman, injectSetOfMark, 
        readSkill, writeSkill, SCREENSHOT_DIR, DOWNLOAD_DIR, path, isTesting, tcode 
    } = helpers;

    const activeTCode = tcode.toUpperCase();
    log(`Initiating System-Wide Search for: ${activeTCode}...`);

    // 🟢 TRACKERS for Training Mode (Anti-Duplicate & Circuit Breaker)
    const usedSelectors = new Set();
    const usedBoxNumbers = new Set(); 
    let aiFailCount = 0;
    let aiCircuitBreaker = false;

    await page.waitForTimeout(2000); 

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
    // 1. LOCATOR ENGINE (Shields + Circuit Breaker)
    // ==========================================
    async function getFieldLocator(memoryKey, humanDescription) {
        let selector = readSkill(activeTCode, memoryKey);
        let locator = null;

        // --- CHECK CACHED MEMORY ---
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

        // --- AI VISION GUESS ---
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
            
            // CIRCUIT BREAKER LOGIC
            if (!isAiGuessValid) {
                boxNum = null; 
                aiFailCount++;
                if (aiFailCount >= 2) {
                    log(`🛑 AI has failed 2 times. Tripping Circuit Breaker. Switching to Manual Mode to save time.`, "WARN");
                    aiCircuitBreaker = true;
                }
            } else {
                aiFailCount = 0; 
            }
        } else {
            log(`(AI Vision skipped due to Circuit Breaker)`);
        }
        
        // --- HUMAN FALLBACK ---
        if (!boxNum) {
            console.log(`\n👉 Look at the popup browser window to find the box number for: ${humanDescription}`);
            boxNum = await askHuman(`Type the box number and press Enter: `);
        }

        // --- FINALIZE AND SAVE ---
        const finalBox = boxNum.trim();
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

        // Cleanup Red Boxes
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
    
    const dateFromLoc = await getFieldLocator('date_from', 'Date from (the first date box)');
    await dateFromLoc.fill(dateFromStr);

    const dateToLoc = await getFieldLocator('date_to', 'Date to (the second date box)');
    await dateToLoc.fill(dateToStr);

    log(`Setting Time Range: ${timeFromStr} to ${timeToStr}`);
    
    const timeFromLoc = await getFieldLocator('time_from', 'Time from (the input box that already says 00:00:00)');
    await timeFromLoc.fill(timeFromStr);

    const timeToLoc = await getFieldLocator('time_to', 'Time to (the input box that already says 23:59:59)');
    await timeToLoc.fill(timeToStr);

    log(`Clearing User field for system-wide search...`);
    const userLoc = await getFieldLocator('user_field', 'User input field');
    await userLoc.fill('*');
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
    // 3. OMNI-EXTRACTOR (Date-Anchor Row Builder)
    // ==========================================
    log("Extracting and PRE-FILTERING data for speed...");
    
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.LOG_TIMEZONE || 'America/Edmonton',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const timestamp = formatter.format(new Date()).replace(/[^0-9]/g, '');
    
    const fileName = `${activeTCode}_raw_feed_${timestamp}.txt`; 
    const finalFilePath = path.join(DOWNLOAD_DIR, fileName);

    let rawTextFeed = "";
    const frames = page.frames();

    for (const frame of frames) {
        try {
            const frameData = await frame.evaluate(() => {
                // Grab standard text
                let allText = document.body.innerText || "";
                
                // 🟢 CRITICAL FIX: Pull values from SAP's virtual <input> table cells!
                const inputNodes = document.querySelectorAll('input');
                const inputValues = Array.from(inputNodes).map(i => i.value).filter(v => v && v.trim().length > 0);
                if (inputValues.length > 0) {
                    allText += "\n" + inputValues.join('\n');
                }

                const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 1);
                
                let groupedOutput = [];
                let currentRow = [];
                
                // Convert vertical soup into horizontal rows based on Date Anchor
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

    // UNCONDITIONAL SAVE: Always write the file, even if 0 bytes
    fs.writeFileSync(finalFilePath, rawTextFeed);

    if (rawTextFeed.trim().length === 0) {
        log(`ℹ️ Extracted raw feed is empty. Assuming a 0-dump scenario (Valid). File saved: ${fileName}`);
    } else {
        log(`✅ LEAN STRUCTURED FEED SAVED: ${fileName}`);
    }

    // ==========================================
    // 4. SKILL.MD INJECTION & AI PARSING
    // ==========================================
    const skillDirPath = path.join(__dirname, '..', 'skills', activeTCode);
    const skillMdPath = path.join(skillDirPath, 'skill.md');

    if (!isTesting && !fs.existsSync(skillMdPath)) {
        log(`Creating default skill.md for ${activeTCode}...`);
        
        if (!fs.existsSync(skillDirPath)) fs.mkdirSync(skillDirPath, { recursive: true });

        const defaultMarkdown = `# DESCRIPTION
Analyzes raw SAP ST22 (Short Dump) text feeds to identify critical system crashes, mapping the exact runtime error, the user responsible, and the timestamp.

# PROMPT
You are a precision SAP Audit Bot.

INSTRUCTIONS:
1. Scan the text for the pattern: DATE (XX/XX/XXXX) followed by TIME (XX:XX:XX).
2. Every time you find this pattern, it represents ONE unique short dump.
3. Extract the Runtime Error and the User associated with that specific timestamp.
4. If a block of text does not have a unique timestamp, do NOT count it as a dump.

# SCHEMA
Return a JSON object exactly matching this structure. Do not include markdown formatting in your response.
\`\`\`json
{
  "dumpsFound": boolean,
  "count": number,
  "dumps": [
    { "runtimeError": "string", "user": "string", "date": "string", "time": "string" }
  ]
}
\`\`\`

# RAW DATA
{{RAW_SAP_DATA}}
`;
        fs.writeFileSync(skillMdPath, defaultMarkdown);
        log(`✅ skill.md created at ${skillMdPath}`);
    }

    if (!fs.existsSync(skillMdPath)) {
        throw new Error(`Missing skill.md for ${activeTCode}. Cannot proceed with AI parsing.`);
    }

    log(`Reading AI instructions from skill.md...`);
    const markdownTemplate = fs.readFileSync(skillMdPath, 'utf8');
    const finalPrompt = markdownTemplate.replace('{{RAW_SAP_DATA}}', `"""\n${rawTextFeed}\n"""`);

    try {
        const response = await fetch(process.env.OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL || "gemma",
                prompt: finalPrompt,
                format: "json",
                stream: false,
                options: {
                    num_ctx: 4096, 
                    top_k: 20,
                    top_p: 0.5,
                    temperature: 0
                }
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
        
        const analysisFilePath = path.join(DOWNLOAD_DIR, `${activeTCode}_analysis_${timestamp}.json`);
        fs.writeFileSync(analysisFilePath, JSON.stringify(aiAnalysisObj, null, 2));
        log(`✅ AI JSON Analysis saved to: ${analysisFilePath}`);

    } catch (error) {
        log(`⚠️ AI Brain Analysis failed: ${error.message}`, "WARN");
        throw error; 
    }
};