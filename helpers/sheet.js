const { google } = require('googleapis');

async function getAuth() {
    return new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
}

async function getQueue(sheetId) {
    const auth = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Explicitly reading a wide range from Row 1 to grab headers
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "'Build Skills'!A1:Z", 
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return [];

    // Row 1 contains our Dynamic Headers
    const headers = rows[0]; 
    
    // Helper to find a column index by name (case-insensitive)
    const getCol = (colName) => {
        const idx = headers.findIndex(h => h && h.toString().trim().toLowerCase() === colName.toLowerCase());
        return idx !== -1 ? idx : -1;
    };

    const tasks = [];

    // Start iterating from Row 2 (index 1 in the array)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const taskNameRaw = row[0];

        // STRICT RULE: If Column A is blank, stop reading down the sheet entirely.
        if (!taskNameRaw || taskNameRaw.toString().trim() === '') {
            break; 
        }

        // Map dynamically based on headers
        tasks.push({
            rowIndex: i + 1, // i=1 is row 2 in Sheets
            taskName: taskNameRaw,
            
            // We map both tcode and taskName so legacy ST22 scripts don't break
            tcode: taskNameRaw, 
            
            skillState: getCol('skill state') !== -1 ? (row[getCol('skill state')] || 'Needs Training') : 'Needs Training',
            
            // We map both target and url to support legacy and UI5 navigation
            target: getCol('target') !== -1 ? row[getCol('target')] : '',
            url: getCol('target') !== -1 ? row[getCol('target')] : '', 

            // --- DYNAMIC TASK-SPECIFIC FIELDS ---
            // If the column exists, grab the data. If not, safely return null.
            productType: getCol('product type') !== -1 ? row[getCol('product type')] : null,
            productName: getCol('product name') !== -1 ? row[getCol('product name')] : null,
            productWeight: getCol('weight') !== -1 ? row[getCol('weight')] : null,
            dateFrom: getCol('date from') !== -1 ? row[getCol('date from')] : null
        });
    }

    return tasks;
}

async function updateRowStatus(sheetId, rowIndex, skillState, statusMessage, timestamp) {
    const auth = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Using batchUpdate to skip Column C (Target) so we don't overwrite the URL
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    // Update Column B (Skill State)
                    range: `'Build Skills'!B${rowIndex}`,
                    values: [[skillState]]
                },
                {
                    // Update Columns D and E (Complete/Error & Timestamp)
                    range: `'Build Skills'!D${rowIndex}:E${rowIndex}`,
                    values: [[statusMessage, timestamp]]
                }
            ]
        }
    });
}

module.exports = { getQueue, updateRowStatus };