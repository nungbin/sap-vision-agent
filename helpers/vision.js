const axios = require('axios');

async function askVisionForBox(page, humanDescription, log) {
    log(`🧠 Asking AI Vision (${process.env.OLLAMA_MODEL}) to locate: ${humanDescription}...`);
    
    try {
        // 🟢 RAM-ONLY SCREENSHOT: Grab the image buffer without touching the hard drive
        const imageBuffer = await page.screenshot();
        const base64Image = imageBuffer.toString('base64');

        const prompt = `You are an SAP RPA agent. Look at the red numbered boxes on the screen. 
        Reply ONLY with the integer number of the box that corresponds to the input field or button for: "${humanDescription}". 
        Do not include any other text, explanations, or punctuation. Just the number.`;

        // 🟢 FAST AXIOS POST: Tuned for Gemma 4:e2b
        const response = await axios.post(process.env.OLLAMA_URL, {
            model: process.env.OLLAMA_MODEL || "gemma4:e2b",
            prompt: prompt,
            images: [base64Image],
            stream: false,
            options: { 
                temperature: 0,
                num_ctx: 4096, // Keeps it fast and stops VRAM swapping
                top_k: 10      
            } 
        });
        
        const text = String(response.data.response).trim();
        const boxNumMatch = text.match(/\d+/);
        
        if (boxNumMatch) {
            log(`🎯 AI Vision suggests Box Number: ${boxNumMatch[0]}`);
            return boxNumMatch[0];
        }
        
        throw new Error(`AI returned unparseable response: ${text}`);
    } catch (error) {
        log(`⚠️ AI Vision failed: ${error.message}`, "WARN");
        return null;
    }
}

module.exports = { askVisionForBox };