const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function askVisionForBox(page, humanDescription, log) {
    log(`🧠 Asking AI Vision (${process.env.OLLAMA_MODEL}) to locate: ${humanDescription}...`);
    
    // 1. Take the screenshot directly inside the helper
    const screenshotPath = path.join(__dirname, '..', 'screenshots', 'vision_temp.png');
    await page.screenshot({ path: screenshotPath });
    const base64Image = fs.readFileSync(screenshotPath, { encoding: 'base64' });

    const prompt = `You are an SAP RPA agent. Look at the red numbered boxes on the screen. 
    Reply ONLY with the integer number of the box that corresponds to the input field or button for: "${humanDescription}". 
    Do not include any other text, explanations, or punctuation. Just the number.`;

    try {
        // 2. Use your fast Axios implementation
        const response = await axios.post(process.env.OLLAMA_URL, {
            model: process.env.OLLAMA_MODEL || "gemma4:e2b",
            prompt: prompt,
            images: [base64Image],
            stream: false,
            options: { 
                temperature: 0,
                num_ctx: 4096, // Keeps it fast on your GTX 1060
                top_k: 10      
            } 
        });
        
        // Axios stores the payload in response.data
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