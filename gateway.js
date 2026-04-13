require('dotenv').config();
process.env.NTBA_FIX_350 = 1; // 🚀 NEW: Silences the file upload deprecation warning
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./helpers/logger');
const { formatReport, createConfirmButton } = require('./helpers/telegram');

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
        log(`❌ FATAL: Ollama is offline (${error.message}).`, 'ERROR');
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

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
function getAvailableTasks() {
    const tasksDir = path.join(__dirname, 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    return fs.readdirSync(tasksDir).filter(file => fs.statSync(path.join(tasksDir, file)).isDirectory());
}

// Dynamically read all task.md files for the AI
function getTaskDescriptions() {
    const tasksDir = path.join(__dirname, 'tasks');
    const tasks = getAvailableTasks();
    let descriptions = "";
    
    for (const task of tasks) {
        const mdPath = path.join(tasksDir, task, 'task.md');
        if (fs.existsSync(mdPath)) {
            descriptions += `\nTask ID: ${task}\nDescription: ${fs.readFileSync(mdPath, 'utf8').trim()}\n---`;
        }
    }
    return descriptions;
}

// ==========================================
// 3. AI & VOICE MICROSERVICES
// ==========================================
async function transcribeVoice(fileUrl) {
    const audioUrl = process.env.STT_TTS_URL.replace(/\/$/, ""); 
    const tgResponse = await fetch(fileUrl);
    const arrayBuffer = await tgResponse.arrayBuffer();
    
    const formData = new FormData();
    const blob = new Blob([arrayBuffer], { type: 'audio/ogg' });
    formData.append('audio', blob, 'voice.ogg');

    const sttResponse = await fetch(`${audioUrl}/transcribe`, { method: 'POST', body: formData });
    if (!sttResponse.ok) throw new Error(`STT HTTP ${sttResponse.status}`);
    
    const result = await sttResponse.json();
    return result.text;
}

async function parseIntent(userInput) {
    // 🚀 UPDATED: Pointing to your new system_prompt.md in the root directory
    const promptPath = path.join(__dirname, 'system_prompt.md');
    if (!fs.existsSync(promptPath)) throw new Error("Missing system_prompt.md");
    
    let promptTemplate = fs.readFileSync(promptPath, 'utf8');
    promptTemplate = promptTemplate.replace('{{AVAILABLE_TASKS}}', getTaskDescriptions());
    promptTemplate = promptTemplate.replace('{{USER_INPUT}}', userInput);

    const response = await fetch(process.env.OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || "gemma",
            prompt: promptTemplate,
            format: "json",
            stream: false,
            options: { temperature: 0 } // Strict routing mode
        })
    });
    
    if (!response.ok) throw new Error("Ollama connection failed");
    const data = await response.json();
    return JSON.parse(data.response.trim());
}

// ==========================================
// 4. GATEWAY INITIALIZATION & CHATOPS
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

    // --- CORE EXECUTION ENGINE ---
    // Extracted so both /run and the Buttons can use it!
    function spawnAgent(taskName, chatId) {
        bot.sendMessage(chatId, `⏳ Spawning *${taskName.toUpperCase()}*...\n\n> _Initializing..._`, { parse_mode: 'Markdown' })
        .then((sentMsg) => {
            const messageId = sentMsg.message_id;
            let finalResult = "", artifactPath = "", summaryReport = "";

            const childProcess = exec(`node agent.js ${taskName}`);

            childProcess.stdout.on('data', (data) => {
                const output = data.toString();
                const finalMatch = output.match(/\[GATEWAY_RESPONSE\]:\s*(.*)/);
                if (finalMatch) finalResult = finalMatch[1];

                const artifactMatch = output.match(/\[GATEWAY_ARTIFACT\]:\s*(.*)/);
                if (artifactMatch) artifactPath = artifactMatch[1].trim();

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
                    bot.editMessageText(`❌ *Crash:* ${finalResult || "Unknown error"}`, {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                    }).catch(() => {});

                    const screenshotsDir = path.join(__dirname, 'screenshots');
                    if (fs.existsSync(screenshotsDir)) {
                        const files = fs.readdirSync(screenshotsDir)
                            .filter(f => f.startsWith('CRASH_') && f.endsWith('.png'))
                            .map(f => ({ name: f, time: fs.statSync(path.join(screenshotsDir, f)).mtime.getTime() }))
                            .sort((a, b) => b.time - a.time); 
                        
                        if (files.length > 0) {
                            bot.sendPhoto(chatId, path.join(screenshotsDir, files[0].name), { 
                                caption: `📸 Crash Snapshot` 
                            }).catch(() => {});
                        }
                    }
                } else {
                    const telegramFriendlySummary = formatReport(summaryReport);
                    const finalMessage = `✅ *Result for ${taskName.toUpperCase()}:*\n${finalResult}\n\n${telegramFriendlySummary}`;

                    bot.editMessageText(finalMessage, {
                        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                    }).then(() => {
                        if (artifactPath && fs.existsSync(artifactPath)) {
                            bot.sendDocument(chatId, artifactPath, { caption: `📄 AI Analysis JSON` }).catch(()=>{});
                        }
                    }).catch(() => {});
                }
            });
        });
    }

    // --- BUTTON LISTENER ---
    bot.on('callback_query', (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        // Remove the buttons immediately so they can't be clicked twice
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});

        if (data.startsWith('RUN_')) {
            const taskName = data.replace('RUN_', '').toLowerCase();
            bot.sendMessage(chatId, `🚀 Confirmation received. Initiating workflow...`);
            spawnAgent(taskName, chatId);
        } else if (data === 'CANCEL') {
            bot.editMessageText(`❌ Action cancelled by user.`, { chat_id: chatId, message_id: messageId }).catch(()=>{});
        }
        
        bot.answerCallbackQuery(query.id); // Tell Telegram we handled it
    });

    // --- MESSAGE LISTENER ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        let text = msg.text;

        // 1. VOICE PROCESSING
        if (msg.voice) {
            try {
                const statusMsg = await bot.sendMessage(chatId, "🎧 *Voice memo received.* Transcribing...", { parse_mode: 'Markdown' });
                const fileLink = await bot.getFileLink(msg.voice.file_id);
                text = await transcribeVoice(fileLink);
                await bot.editMessageText(`🗣️ *I heard:* "${text}"\n\n🧠 _Analyzing intent..._`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
            } catch (error) {
                bot.sendMessage(chatId, `❌ Voice processing failed: ${error.message}`);
                return;
            }
        }

        if (!text) return; 

        // 2. EXPLICIT COMMANDS
        if (text === '/start') {
            bot.sendMessage(chatId, "👋 Gateway online. Type /list for tasks or send a voice memo!");
        } 
        else if (text === '/list') {
            const tasks = getAvailableTasks();
            bot.sendMessage(chatId, "📋 *Available Tasks:*\n\n" + tasks.map(t => `• \`${t}\``).join('\n') + "\n\nType `/run [task]` or just ask me in plain english!", { parse_mode: 'Markdown' });
        } 
        else if (text.startsWith('/run ')) {
            const taskName = text.split(' ')[1]?.toLowerCase();
            if (getAvailableTasks().includes(taskName)) {
                spawnAgent(taskName, chatId); // Explicit run, no button needed
            } else {
                bot.sendMessage(chatId, `⚠️ Unknown task: ${taskName}`);
            }
        }
        else if (text.startsWith('/')) {
            bot.sendMessage(chatId, `⚠️ Unrecognized command. Use /run or normal text.`);
        }
        
        // 3. AI NATURAL LANGUAGE ROUTING (Text & Voice)
        else {
            try {
                // If it wasn't voice, give them a loading indicator
                if (!msg.voice) bot.sendMessage(chatId, `🧠 _Analyzing intent..._`, { parse_mode: 'Markdown' });
                
                const intentObj = await parseIntent(text);

                if (intentObj && intentObj.task && getAvailableTasks().includes(intentObj.task.toLowerCase())) {
                    const matchedTask = intentObj.task.toLowerCase();
                    
                    // 🚀 CHANGED: Switched to HTML parsing to prevent Markdown crashes from AI underscores
                    bot.sendMessage(
                        chatId, 
                        `🤖 <b>Intent Match:</b> <code>${matchedTask}</code>\n<i>Reason:</i> ${intentObj.reason}\n\nShall I execute this?`, 
                        { parse_mode: 'HTML', ...createConfirmButton(matchedTask) }
                    );
                } else {
                    bot.sendMessage(chatId, `🤷‍♂️ I couldn't match that to a known SAP task. \n<i>(Reason: ${intentObj.reason})</i>`, { parse_mode: 'HTML' });
                }                
            } catch (error) {
                bot.sendMessage(chatId, `❌ AI Intent Parsing Failed: ${error.message}`);
            }
        }
    });
}

startGateway();