const axios = require('axios');

async function askVisionForBox(page, humanDescription, log) {
    log(`🧠 Asking AI Vision (${process.env.OLLAMA_MODEL}) to locate: ${humanDescription}...`);
    
    try {
        // 🟢 RAM-ONLY SCREENSHOT: Grab the image buffer without touching the hard drive
        const imageBuffer = await page.screenshot();
        const base64Image = imageBuffer.toString('base64');

        // 🟢 THE FIX: Force Structured JSON and Label Verification
        const prompt = `You are an SAP RPA agent. Look at the red numbered boxes on the screen. 
        Find the input field or button that corresponds to: "${humanDescription}".
        
        Before giving the box number, you MUST identify the literal text label on the screen physically located next to the target box.
        
        You must reply in strict JSON format.
        Example:
        {
            "detected_label": "the exact label text next to the box",
            "box_number": 42
        }`;

        // 🟢 FAST AXIOS POST: Tuned for Gemma 4:e4b
        const response = await axios.post(process.env.OLLAMA_URL, {
            model: process.env.OLLAMA_MODEL || "gemma4:e4b",
            prompt: prompt,
            images: [base64Image],
            stream: false,
            format: "json", // 🔒 FORCES OLLAMA TO RETURN VALID JSON
            options: { 
                temperature: 0, // Zero temperature for maximum determinism
                num_ctx: 4096, 
                top_k: 10      
            } 
        });
        
        const text = String(response.data.response).trim();
        
        // 🟢 PARSE THE STRUCTURED RESPONSE
        const parsed = JSON.parse(text);
        
        if (parsed.box_number) {
            log(`🎯 AI grounded on label [${parsed.detected_label}] -> Box Number: ${parsed.box_number}`);
            return parsed.box_number.toString(); 
        }
        
        throw new Error(`AI returned JSON but missing box_number: ${text}`);
    } catch (error) {
        log(`⚠️ AI Vision failed: ${error.message}`, "WARN");
        return null;
    }
}

module.exports = { askVisionForBox };