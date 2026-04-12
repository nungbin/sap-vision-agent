// helpers/telegram.js

/**
 * Formats standard terminal text into Telegram-friendly Markdown.
 * Converts literal \n characters back into real line breaks and 
 * ensures we don't crash Telegram with too much text.
 */
function formatReport(rawText) {
    if (!rawText) return "";
    
    // 1. Convert literal \n from the terminal back to real line breaks
    let formatted = rawText.replace(/\\n/g, '\n');
    
    // 2. Truncate to Telegram's limit (4096)
    // We leave a buffer for the header/footer text.
    if (formatted.length > 3800) {
        formatted = formatted.substring(0, 3800) + "\n\n...[⚠️ REPORT TRUNCATED: Too large for Telegram. Please check the attached JSON file for full details.]";
    }
    
    return formatted;
}

/**
 * Generates an interactive keyboard for confirmation.
 * This will be used when we wire up the AI "Intent" parsing.
 */
function createConfirmButton(taskName) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: `✅ Run ${taskName.toUpperCase()}`, callback_data: `RUN_${taskName.toUpperCase()}` },
                    { text: `❌ Cancel`, callback_data: `CANCEL` }
                ]
            ]
        }
    };
}

module.exports = {
    formatReport,
    createConfirmButton
};