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
    // 5. THE LEAN OMNI-EXTRACTOR (SPEED OPTIMIZED)
    // ==========================================
    log("Extracting and PRE-FILTERING data for speed...");

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-T]/g, '').slice(0, 14);
    const fileName = `${TCODE}_raw_feed_${timestamp}.txt`; 
    const finalFilePath = path.join(DOWNLOAD_DIR, fileName);

    let rawTextFeed = "";
    const frames = page.frames();

    for (const frame of frames) {
        try {
            const frameData = await frame.evaluate(() => {
                let lines = [];
                // Target the body text and input values
                const bodyText = document.body.innerText || "";
                const inputValues = Array.from(document.querySelectorAll('input')).map(i => i.value);
                
                // Combine them into one big array of strings
                const combined = bodyText.split('\n').concat(inputValues);

                // 🟢 THE SPEED HACK: Only keep lines that look like Date, Time, or Dump data
                // This removes 80% of the SAP UI "noise" before the AI sees it
                return combined.filter(line => {
                    const l = line.trim();
                    const isDate = /\d{2}\/\d{2}\/\d{4}/.test(l);
                    const isTime = /\d{2}:\d{2}:\d{2}/.test(l);
                    const isError = /^[A-Z_]{5,}$/.test(l); // Long uppercase error codes
                    const isUser = /^[A-Z0-9]{3,12}$/.test(l); // SAP User IDs
                    return isDate || isTime || isError || isUser;
                }).join('\n');
            });
            rawTextFeed += "\n" + frameData;
        } catch (e) {}
    }

    // Now our text feed is much smaller, meaning Gemma will finish in seconds!
    if (rawTextFeed.trim().length > 10) {
        const fs = require('fs');
        fs.writeFileSync(finalFilePath, rawTextFeed);
        log(`✅ LEAN FEED SAVED (Reduced size for faster AI processing)`);
    }


// ==========================================
    // 6. THE PRODUCTION-READY "CHAIN-OF-THOUGHT" PROMPT
    // ==========================================
    log("Sending feed to AI with Chain-of-Thought instructions...");

    const prompt = `You are a precision SAP Audit Bot.
    
INSTRUCTIONS:
1. Scan the text for the pattern: DATE (XX/XX/XXXX) followed by TIME (XX:XX:XX).
2. Every time you find this pattern, it represents ONE unique short dump.
3. Extract the Runtime Error and the User associated with that specific timestamp.
4. If a block of text does not have a unique timestamp, do NOT count it as a dump.

Return a JSON object:
{
  "dumpsFound": boolean,
  "count": number,
  "dumps": [
    { "runtimeError": "string", "user": "string", "date": "string", "time": "string" }
  ]
}

RAW DATA:
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
                format: "json",
                stream: false,
                options: {
                    // 🟢 SPEED FIX 1: Drop to 4096. 
                    // 8192 is overkill for a few ST22 rows and is choking your 1060.
                    num_ctx: 4096, 
                    
                    // 🟢 SPEED FIX 2: Reduce 'top_k' and 'top_p'.
                    // This limits how many "options" the AI considers per word, 
                    // making it much faster on older Pascal-architecture cards.
                    top_k: 20,
                    top_p: 0.5,
                    temperature: 0
                }
            })
        });
        
        // ... rest of your parsing logic        
        if (!response.ok) throw new Error(`Ollama API returned status: ${response.status}`);
        
        const data = await response.json();
        
        const aiAnalysisObj = JSON.parse(data.response.trim());
        
        console.log(`\n======================================================`);
        console.log(`🧠 AI BRAIN ANALYSIS (JSON)`);
        console.log(`======================================================`);
        console.log(JSON.stringify(aiAnalysisObj, null, 2)); 
        console.log(`======================================================\n`);
        
        const analysisFilePath = path.join(DOWNLOAD_DIR, `${TCODE}_analysis_${timestamp}.json`);
        const fs = require('fs');
        fs.writeFileSync(analysisFilePath, JSON.stringify(aiAnalysisObj, null, 2));
        log(`✅ AI JSON Analysis saved to: ${analysisFilePath}`);

    } catch (error) {
        log(`⚠️ AI Brain Analysis failed: ${error.message}`, "WARN");
    }
};
