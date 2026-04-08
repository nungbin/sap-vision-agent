const axios = require('axios');
const { log } = require('./logger');

async function askVisionAgent(prompt, imageBuffer) {
    log("Querying Vision Model (Gemma)...");
    try {
        const response = await axios.post(process.env.OLLAMA_URL, {
            model: process.env.OLLAMA_MODEL,
            prompt: prompt,
            images: [imageBuffer.toString('base64')],
            stream: false,
            format: "json"
        });
        log(`Model replied with: ${response.data.response}`, 'DEBUG', true);
        return JSON.parse(response.data.response);
    } catch (error) {
        log(`Ollama API Error: ${error.message}`, 'ERROR');
        return null;
    }
}

module.exports = { askVisionAgent };