require('dotenv').config();
process.env.NTBA_FIX_350 = 1; // Silences the file upload deprecation warning
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./helpers/logger');
const { formatReport, createConfirmButton } = require('./helpers/telegram');

// ==========================================
// 1. SESSION MANAGEMENT (Conversational Memory)
// ==========================================
const activeSessions = new Map();

function getSession(chatId) {
    if (!activeSessions.has(chatId)) {
        activeSessions.set(chatId, {
            targetTask: null,     // The task we are currently slot-filling for
            history: [],          // The LLM conversation array
            lastActive: Date.now()
        });
    }
    const session = activeSessions.get(chatId);
    session.lastActive = Date.now();
    return session;
}

function clearSession(chatId) {
    activeSessions.delete(chatId);
}

// Memory Garbage Collection: Clear inactive sessions after 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [chatId, session] of activeSessions.entries()) {
        if (now - session.lastActive > 15 * 60 * 1000) {
            activeSessions.delete(chatId);
            log(`🧹 Garbage Collection: Cleared idle session for chat ${chatId}`);
        }
    }
}, 60000);

// ==========================================
// 2. HEALTH CHECKS
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
// 3. HELPER FUNCTIONS
// ==========================================
function getAvailableTasks() {
    const tasksDir = path.join(__dirname, 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    return fs.readdirSync(tasksDir).filter(file => fs.statSync(path.join(tasksDir, file)).isDirectory());
}

// Dynamically read all task.md files to find INTENT routing OR specific PARAMETERS
function getTaskSchemas(specificTask = null) {
    const tasksDir = path.join(__dirname, 'tasks');
    const tasks = specificTask ? [specificTask] : getAvailableTasks();
    let descriptions = "";
    
    for (const task of tasks) {
        const mdPath = path.join(tasksDir, task, 'task.md');
        if (fs.existsSync(mdPath)) {
            descriptions += `\nTask ID: ${task}\n${fs.readFileSync(mdPath, 'utf8').trim()}\n---`;
        }
    }
    return descriptions;
}

// ==========================================
// 4. AI & VOICE MICROSERVICES
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

async function converseWithAI(chatId, userInput) {
    const session = getSession(chatId);
    
    const promptPath = path.join(__dirname, 'system_prompt.md');
    if (!fs.existsSync(promptPath)) throw new Error("Missing system_prompt.md");
    
    // We only feed the specific task schema if we are locked into a task, otherwise feed all of them for routing
    const schemaToFeed = session.targetTask ? getTaskSchemas(session.targetTask) : getTaskSchemas();
    
    let basePrompt = fs.readFileSync(promptPath, 'utf8');
    basePrompt = basePrompt.replace('{{AVAILABLE_TASKS}}', schemaToFeed);

    // Initialize conversation array if empty
    if (session.history.length === 0) {
        session.history.push({ role: "system", content: basePrompt });
    } else {
        // Always ensure the system prompt is up to date with the latest schema
        session.history[0].content = basePrompt;
    }

    session.history.push({ role: "user", content: userInput });

    // Sliding Window: Keep system prompt + last 8 messages to prevent context overflow
    if (session.history.length > 9) {
        session.history = [session.history[0], ...session.history.slice(-8)];
    }

    // 🚀 THE FIX: Dynamically switch to the conversational endpoint!
    const chatUrl = process.env.OLLAMA_URL.replace('/api/generate', '/api/chat');

    const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || "gemma",
            messages: session.history, 
            format: "json",
            stream: false,
            options: { temperature: 0 } 
        })
    });
    
    if (!response.ok) throw new Error("Ollama connection failed");
    
    const data = await response.json();
    
    // Safety check in case the API responds weirdly
    if (!data.message || !data.message.content) {
        throw new Error(`Unexpected Ollama response format: ${JSON.stringify(data)}`);
    }

    const aiResponseText = data.message.content.trim();
    
    // Save AI response to memory
    session.history.push({ role: "assistant", content: aiResponseText });
    
    return JSON.parse(aiResponseText);
}

// ==========================================
// 5. GATEWAY INITIALIZATION & CHATOPS
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
    // 🚀 NEW: Accepts a JSON payload and safely base64 encodes it for CLI transit
    function spawnAgent(taskName, chatId, payloadObj = {}) {
        const encodedPayload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
        
        bot.sendMessage(chatId, `⏳ Spawning *${taskName.toUpperCase()}*...\n\n> _Initializing..._`, { parse_mode: 'Markdown' })
        .then((sentMsg) => {
            const messageId = sentMsg.message_id;
            let finalResult = "", artifactPath = "", summaryReport = "";

            // Inject the base64 payload as the second argument
            const childProcess = exec(`node agent.js ${taskName} ${encodedPayload}`);

            childProcess.stdout.on('data', (data) => {
                const output = data.toString();

                const finalMatch = output.match(/.*\[GATEWAY_RESPONSE\]:\s*(.*)/);
                if (finalMatch) finalResult = finalMatch[1];

                const artifactMatch = output.match(/.*\[GATEWAY_ARTIFACT\]:\s*(.*)/);
                if (artifactMatch) artifactPath = artifactMatch[1].trim();

                const summaryMatch = output.match(/.*\[GATEWAY_SUMMARY\]:\s*(.*)/);
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
                    bot.editMessageText(`❌ <b>Crash:</b> ${finalResult || "Unknown error (Exit Code " + code + ")"}`, {
                        chat_id: chatId, message_id: messageId, parse_mode: 'HTML'
                    }).catch(err => log(`🚨 Telegram Error: ${err.message}`, "ERROR"));

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
                    
                    // 🚀 THE FIX: Convert Markdown asterisks to safe HTML <b> tags
                    let htmlSummary = telegramFriendlySummary.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                    htmlSummary = htmlSummary.replace(/\*(.*?)\*/g, '<b>$1</b>');

                    const finalMessage = `✅ <b>Result for ${taskName.toUpperCase()}:</b>\n${finalResult}\n\n${htmlSummary}`;

                    bot.editMessageText(finalMessage, {
                        chat_id: chatId, message_id: messageId, parse_mode: 'HTML'
                    }).then(() => {
                        if (artifactPath && fs.existsSync(artifactPath)) {
                            bot.sendDocument(chatId, artifactPath, { caption: `📄 AI Analysis JSON` }).catch(()=>{});
                        }
                    }).catch(err => {
                        // 🚀 THE FIX: Never swallow errors again!
                        log(`🚨 Telegram rejected the final message! Error: ${err.message}`, "ERROR");
                        // Send a safe fallback so the UI doesn't hang
                        bot.editMessageText(`✅ Task Complete, but Telegram rejected the formatting of the AI summary.`, {chat_id: chatId, message_id: messageId});
                    });
                }
            });
        });
    }

    // --- BUTTON LISTENER ---
    bot.on('callback_query', (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        // Remove the buttons immediately
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(()=>{});

        if (data.startsWith('RUN_')) {
            const taskName = data.replace('RUN_', '').toLowerCase();
            const session = getSession(chatId);
            
            // Extract the payload memory before we wipe it
            const executionPayload = session.latestPayload || {};
            
            bot.sendMessage(chatId, `🚀 Confirmation received. Executing with payload...`);
            clearSession(chatId); // 🚀 Memory Wipe!
            
            spawnAgent(taskName, chatId, executionPayload);
        } else if (data === 'CANCEL') {
            bot.editMessageText(`❌ Action cancelled. Memory cleared.`, { chat_id: chatId, message_id: messageId }).catch(()=>{});
            clearSession(chatId); // 🚀 Memory Wipe!
        }
        
        bot.answerCallbackQuery(query.id); 
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

        // 2. EXPLICIT POWER-USER COMMANDS
        if (text === '/start') {
            clearSession(chatId);
            bot.sendMessage(chatId, "👋 Gateway online. Type /list for tasks or just speak naturally!");
        } 
        else if (text === '/list') {
            const tasks = getAvailableTasks();
            bot.sendMessage(chatId, "📋 *Available Tasks:*\n\n" + tasks.map(t => `• \`${t}\``).join('\n') + "\n\nType `/run [task]` or ask me to trigger one!", { parse_mode: 'Markdown' });
        } 
        else if (text.startsWith('/run ')) {
            const taskName = text.split(' ')[1]?.toLowerCase();
            if (getAvailableTasks().includes(taskName)) {
                clearSession(chatId); // Prevent explicit runs from bleeding into conversational memory
                bot.sendMessage(chatId, `⚡ Fast-track execution triggered.`);
                spawnAgent(taskName, chatId, {}); 
            } else {
                bot.sendMessage(chatId, `⚠️ Unknown task: ${taskName}`);
            }
        }
        else if (text === '/cancel') {
            clearSession(chatId);
            bot.sendMessage(chatId, "🗑️ Session memory wiped. What's next?");
        }
        else if (text.startsWith('/')) {
            bot.sendMessage(chatId, `⚠️ Unrecognized command. Use /run, /cancel, or normal text.`);
        }
        
        // 3. AI NATURAL LANGUAGE CONVERSATIONAL ROUTING
        else {
            try {
                if (!msg.voice) bot.sendMessage(chatId, `🧠 _Thinking..._`, { parse_mode: 'Markdown' });
                
                const session = getSession(chatId);
                const aiState = await converseWithAI(chatId, text);

                if (aiState.status === "PIVOT") {
                    clearSession(chatId);
                    bot.sendMessage(chatId, aiState.reply_to_user || "Pivot understood. Memory cleared.");
                    return;
                }

                if (aiState.status === "INCOMPLETE") {
                    // 🚀 FIXED: Look for aiState.task
                    if (!session.targetTask && aiState.task) {
                         session.targetTask = aiState.task.toLowerCase();
                    }
                    bot.sendMessage(chatId, aiState.reply_to_user);
                } 
                
                else if (aiState.status === "COMPLETE") {
                    // Lock in the payload
                    session.latestPayload = aiState.payload;
                    
                    // 🚀 FIXED: Look for aiState.task
                    const finalTask = session.targetTask || aiState.task || Object.keys(aiState.payload)[0];

                    const confirmationMessage = `✅ **Task Ready:** <code>${finalTask}</code>\n\n` +
                        `<b>Parameters gathered:</b>\n<pre>${JSON.stringify(aiState.payload, null, 2)}</pre>\n\n` +
                        `<i>${aiState.reply_to_user}</i>`;

                    bot.sendMessage(chatId, confirmationMessage, { 
                        parse_mode: 'HTML', 
                        ...createConfirmButton(finalTask) 
                    });
                }
            } catch (error) {
                bot.sendMessage(chatId, `❌ AI Processing Failed: ${error.message}`);
            }
        }
    });
}

startGateway();