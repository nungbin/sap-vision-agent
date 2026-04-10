module.exports = async function(page, helpers) {
    const { log, locateInAnyFrame, SCREENSHOT_DIR, DOWNLOAD_DIR, path, readMemory, writeMemory, askVisionAgent, askHuman, injectSetOfMark } = helpers;

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

        // 🟢 SAP WEBGUI FIX: Frame-aware aggressive cleanup of Set-of-Mark boxes
        const frames = page.frames();
        for (const frame of frames) {
            try {
                await frame.evaluate(() => {
                    const boxes = document.querySelectorAll('.som-box, div[style*="z-index: 9999"]');
                    boxes.forEach(box => box.remove());
                });
            } catch (e) {
                // Ignore cross-origin frame errors
            }
        }        

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


    // ==========================================
    // 5. THE OMNI-EXTRACTOR (TEXT + INPUT VALUES)
    // ==========================================
    log("Bypassing SAP UI Traps. Extracting Omni-Feed (Text + Input Values)...");

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-T]/g, '').slice(0, 14);
    const fileName = `${TCODE}_raw_feed_${timestamp}.txt`; 
    const finalFilePath = path.join(DOWNLOAD_DIR, fileName);

    let rawTextFeed = "";

    // Loop through ALL iframes, ignoring SAP's layout
    const frames = page.frames();
    for (const frame of frames) {
        try {
            const frameText = await frame.evaluate(() => {
                let extracted = [];
                
                // 1. Grab all standard text
                const body = document.querySelector('body');
                if (body && body.innerText) {
                    extracted.push(body.innerText);
                }
                
                // 2. THE SAP SECRET: Grab all text hidden inside input fields!
                const inputs = document.querySelectorAll('input');
                inputs.forEach(input => {
                    if (input.value && input.value.trim() !== "") {
                        extracted.push(input.value.trim());
                    }
                });

                // 3. Grab text hidden in custom tooltips
                const spans = document.querySelectorAll('span[title], div[title]');
                spans.forEach(el => {
                    if (el.getAttribute('title')) {
                        extracted.push(el.getAttribute('title').trim());
                    }
                });

                return extracted.join('\n\n');
            });
            
            if (frameText && frameText.trim().length > 0) {
                rawTextFeed += "\n" + frameText;
            }
        } catch (e) {
            // Safely ignore cross-origin frame errors
        }
    }

    // Clean up excessive whitespace to save AI tokens
    rawTextFeed = rawTextFeed.replace(/[\r\n]{3,}/g, '\n\n'); 
    rawTextFeed = rawTextFeed.replace(/[ \t]{3,}/g, '   ');    

    if (rawTextFeed.length > 50) {
        const fs = require('fs');
        fs.writeFileSync(finalFilePath, rawTextFeed);
        log(`✅ SUCCESSFULLY EXTRACTED OMNI-FRAME FEED TO: ${finalFilePath}`);
    } else {
        throw new Error("Could not extract raw text from the screen.");
    }


    // ==========================================
    // 6. AI BRAIN ANALYSIS (JSON OUTPUT)
    // ==========================================
    log("Sending Omni-Feed to local AI Brain for JSON analysis...");

    // We explicitly define the JSON schema we want the AI to return
    const prompt = `You are an expert SAP Basis administrator. Analyze this raw text dump from SAP ST22.
    
Extract the short dump details and return them STRICTLY as a JSON object matching this exact schema:
{
  "dumpsFound": boolean,
  "dumps": [
    {
      "runtimeError": "string (e.g., COMPUTE_INT_ZERODIVIDE)",
      "user": "string",
      "date": "string",
      "time": "string"
    }
  ]
}

If no dumps are found, set "dumpsFound" to false and leave the "dumps" array empty.
Do NOT include any markdown formatting, explanations, or introductory text. Just output the raw JSON.

RAW SAP DATA:
"""
${rawTextFeed}
"""`;

    try {
        const response = await fetch(process.env.OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL || "gemma",
                prompt: prompt,
                format: "json", // 🟢 MAGIC FLAG: Forces Ollama to return valid JSON
                stream: false
            })
        });
        
        if (!response.ok) throw new Error(`Ollama API returned status: ${response.status}`);
        
        const data = await response.json();
        
        // Parse the AI's string response into a real JavaScript object!
        const aiAnalysisObj = JSON.parse(data.response.trim());
        
        console.log(`\n======================================================`);
        console.log(`🧠 AI BRAIN ANALYSIS (JSON)`);
        console.log(`======================================================`);
        // Print it beautifully formatted
        console.log(JSON.stringify(aiAnalysisObj, null, 2)); 
        console.log(`======================================================\n`);
        
        // Save it as a proper .json file!
        const analysisFilePath = path.join(DOWNLOAD_DIR, `${TCODE}_analysis_${timestamp}.json`);
        const fs = require('fs');
        fs.writeFileSync(analysisFilePath, JSON.stringify(aiAnalysisObj, null, 2));
        log(`✅ AI JSON Analysis saved to: ${analysisFilePath}`);

    } catch (error) {
        log(`⚠️ AI Brain Analysis failed: ${error.message}`, "WARN");
    }
}; // Closes the module.exports function
