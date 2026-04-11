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
    
    // Explicitly reading from the 'Build Skills' tab
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "'Build Skills'!A2:D", 
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    return rows.map((row, index) => {
        return {
            rowIndex: index + 2, 
            tcode: row[0],
            skillState: row[1] || 'Needs Training'
        };
    }).filter(row => row.tcode);
}

async function updateRowStatus(sheetId, rowIndex, skillState, statusMessage, timestamp) {
    const auth = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Explicitly updating the 'Build Skills' tab
    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'Build Skills'!B${rowIndex}:D${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [[skillState, statusMessage, timestamp]]
        }
    });
}

module.exports = { getQueue, updateRowStatus };