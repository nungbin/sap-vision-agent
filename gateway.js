require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./helpers/logger');

// 🚀 IMPORT THE NEW HELPER
const { formatReport } = require('./helpers/telegram');

// ==========================================
// 1. HEALTH CHECKS
// ==========================================
async function checkOllama() {
    try {
        const baseUrl = new URL(process.env.OLLAMA_URL).origin;
        const res = await fetch(baseUrl);
        if (res.ok) {
            log(`✅ System Check: Ollama AI Brain is ONLINE at ${baseUrl}`);
            return true;
        }
        throw new Error(`HTTP Status ${res.status}`);
    } catch (error) {
        log(`❌ FATAL: Ollama is offline or unreachable (${error.message}).`, 'ERROR');
        process.exit(1);
    }
}

async function checkAudioService() {
    const audioUrl = process.env.STT_TTS_URL.replace(/\/$/, ""); 
    if (!audioUrl) return false;
    try {
        const res = await fetch(`${audioUrl}/transcribe`, { method: 'POST' });
        if (res.status === 400) {
            log(`✅ System Check: STT/TTS Microservice is ONLINE at ${audioUrl}`);
            return true;
        }
    } catch (error) {
        log(`⚠️ System Check: STT/TTS Microservice is offline. Voice disabled.`, 'WARN');
        return false;
    }
}

function getAvailableTasks() {
    const tasksDir = path.join(__dirname, 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    return fs.readdirSync(tasksDir).filter(file => fs.statSync(path.join(tasksDir, file)).isDirectory());
}

// ==========================================
// 2. GATEWAY INITIALIZATION & CHATOPS
// ==========================================
async function startGateway() {
    log("==================================================");
    log("🌌 SAP VISION AGENT: CHATOPS GATEWAY STARTING...");
    log("==================================================");

    await checkOllama();
    await checkAudioService();

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) process.exit(1);

    const bot = new TelegramBot(token, { polling: true });
    log(`🤖 Telegram Bot connected and polling...`);

    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text) return;

        log(`[TELEGRAM] Message from ${msg.chat.first_name}: "${text}"`);

        if (text === '/start') {
            bot.sendMessage(chatId, "👋 Gateway online. Type /list for tasks.");
        } 
        else if (text === '/list') {
            const tasks = getAvailableTasks();
            let response = "📋 *Available Tasks:*\n\n" + tasks.map(t => `• \`${t}\``).join('\n') + "\n\nType: `/run [task]`";
            bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        } 
        else if (text.startsWith('/run ')) {
            const taskName = text.split(' ')[1]?.toLowerCase();
            const tasks = getAvailableTasks();

            if (!taskName || !tasks.includes(taskName)) {
                bot.sendMessage(chatId, `⚠️ Unknown task: ${taskName}`);
                return;
            }

            bot.sendMessage(chatId, `⏳ Spawning *${taskName.toUpperCase()}*...\n\n> _Initializing..._`, { parse_mode: 'Markdown' })
            .then((sentMsg) => {
                const messageId = sentMsg.message_id;
                let finalResult = "";
                let artifactPath = "";
                let summaryReport = ""; // 🚀 NEW: Variable to hold the summary

                const childProcess = exec(`node agent.js ${taskName}`);

                childProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    
                    const finalMatch = output.match(/\[GATEWAY_RESPONSE\]:\s*(.*)/);
                    if (finalMatch) finalResult = finalMatch[1];

                    const artifactMatch = output.match(/\[GATEWAY_ARTIFACT\]:\s*(.*)/);
                    if (artifactMatch) artifactPath = artifactMatch[1].trim();

                    // 🚀 NEW: Catch the Summary tag from st22.js
                    const summaryMatch = output.match(/\[GATEWAY_SUMMARY\]:\s*(.*)/);
                    if (summaryMatch) summaryReport = summaryMatch[1].trim();

                    const infoMatch = output.match(/\[INFO\]\s+(.*)/);
                    if (infoMatch && !output.includes('GATEWAY_')) {
                        bot.editMessageText(`⏳ Running *${taskName.toUpperCase()}*...\n\n> _${infoMatch[1].trim()}_`, {
                            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                        }).catch(() => {}); 
                    }
                });

                childProcess.on('close', (code) => {
                    const isCrash = finalResult.toLowerCase().includes('crashed') || code !== 0;

                    if (isCrash) {
                        bot.editMessageText(`❌ *Crash:* ${finalResult || "Error"}`, {
                            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                        });
                        // ... Screenshot logic remains here ...
                    } else {
                        // 🚀 SUCCESS: USE THE HELPER TO FORMAT THE REPORT
                        const telegramFriendlySummary = formatReport(summaryReport);
                        const finalMessage = `✅ *Result for ${taskName.toUpperCase()}:*\n${finalResult}\n\n${telegramFriendlySummary}`;

                        bot.editMessageText(finalMessage, {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown'
                        }).then(() => {
                            if (artifactPath && fs.existsSync(artifactPath)) {
                                bot.sendDocument(chatId, artifactPath, { caption: `📄 AI Analysis JSON` });
                            }
                        }).catch(() => {});
                    }
                });
            });
        }
    });
}

startGateway();