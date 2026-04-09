const { google } = require('googleapis');
const { log } = require('./logger');

let authClient = null;

async function getAuth() {
    if (!authClient) {
        authClient = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets'], 
        });
    }
    return authClient;
}

async function getQueueFromSheet() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return [];

    try {
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        log(`Fetching task queue from Google Sheet...`);
        // Fetch Columns A and B
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'Build Skills!A2:B', 
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        let queue = [];
        for (let i = 0; i < rows.length; i++) {
            const tcode = rows[i][0];
            const overwriteRaw = rows[i][1]; 
            
            // Convert checkbox value to boolean
            const isOverwrite = overwriteRaw && overwriteRaw.toUpperCase() === 'TRUE';

            if (tcode && tcode.trim().length > 0) {
                queue.push({
                    tcode: tcode.trim().toUpperCase(),
                    overwrite: isOverwrite,
                    rowIndex: i + 2 
                });
            }
        }
        return queue;

    } catch (error) {
        log(`Failed to fetch Google Sheet: ${error.message}`, 'ERROR');
        return []; 
    }
}


async function updateSheetStatus(rowIndex, statusMsg) {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return;

    try {
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const tz = process.env.LOG_TIMEZONE || 'UTC';
        const timestamp = new Date().toLocaleString('en-US', { timeZone: tz });

        // SHIFTED: Now updating B (Overwrite), C (Status), and D (Timestamp)
        await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `Build Skills!B${rowIndex}:D${rowIndex}`,
            valueInputOption: 'USER_ENTERED', // Required for Google to trigger the checkbox uncheck
            resource: {
                // "FALSE" automatically unchecks the Overwrite box!
                values: [["FALSE", statusMsg, timestamp]] 
            }
        });
        
        log(`📝 Updated Sheet Row ${rowIndex} -> [${statusMsg}] (Reset Overwrite Flag)`);
    } catch (error) {
        log(`Failed to write status to Google Sheet: ${error.message}`, 'ERROR');
    }
}

module.exports = { getQueueFromSheet, updateSheetStatus };