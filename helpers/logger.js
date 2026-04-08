const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const tz = process.env.LOG_TIMEZONE || 'UTC';

// Helper to get formatted timezone string
function getTimestamp() {
    try {
        return new Date().toLocaleString('en-US', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            fractionalSecondDigits: 3, hour12: false
        }) + ` [${tz}]`;
    } catch (e) {
        return new Date().toISOString(); // Fallback to UTC if timezone name is invalid
    }
}

// FIX: Catch slashes, commas, and other illegal characters for filenames
const safeTimeForFile = getTimestamp()
    .replace(/[\/\\:.,\[\] ]/g, '-') // Replace bad chars with hyphens
    .replace(/-+/g, '-');            // Clean up any double-hyphens (e.g., "--" to "-")

const logFilePath = path.join(LOG_DIR, `agent_${safeTimeForFile}.log`);
const isVerbose = process.env.VERBOSE === 'true';

function cleanOldLogs() {
    const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 7;
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    fs.readdirSync(LOG_DIR).forEach(file => {
        const filePath = path.join(LOG_DIR, file);
        if (fs.statSync(filePath).mtimeMs < cutoff && filePath !== logFilePath) {
            fs.unlinkSync(filePath);
            deletedCount++;
        }
    });
    if (deletedCount > 0) log(`Cleaned up ${deletedCount} old log file(s).`);
}

function log(msg, type = 'INFO', verboseOnly = false) {
    const logLine = `[${getTimestamp()}] [${type}] ${msg}`;
    fs.appendFileSync(logFilePath, logLine + '\n');
    if (!verboseOnly || isVerbose || type === 'ERROR') console.log(logLine);
}

cleanOldLogs();

module.exports = { log };