const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const SKILLS_DIR = path.join(__dirname, '../skills');
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });

function getMemoryPath(tcode) {
    return path.join(SKILLS_DIR, `memory_${tcode.toLowerCase()}.json`);
}

function readMemory(tcode, actionKey) {
    const memoryPath = getMemoryPath(tcode);
    if (fs.existsSync(memoryPath)) {
        const data = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
        return data[actionKey] || null;
    }
    return null;
}

function writeMemory(tcode, actionKey, selector) {
    const memoryPath = getMemoryPath(tcode);
    let data = {};
    if (fs.existsSync(memoryPath)) {
        data = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
    data[actionKey] = selector;
    fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2));
    log(`🧠 Memory updated for ${tcode}: [${actionKey}] saved.`);
}

function deleteMemory(tcode, actionKey) {
    const memoryPath = getMemoryPath(tcode);
    if (fs.existsSync(memoryPath)) {
        let data = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
        if (data[actionKey]) {
            delete data[actionKey];
            fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2));
            log(`🗑️ Memory purged for ${tcode}: [${actionKey}] removed (Self-Healing activated).`, 'WARN');
        }
    }
}

function purgeAllMemory(tcode) {
    const memoryPath = getMemoryPath(tcode);
    if (fs.existsSync(memoryPath)) {
        fs.unlinkSync(memoryPath);
        log(`🧨 ENTIRE MEMORY PURGED FOR ${tcode}. Forcing re-learn on next run.`, 'WARN');
    }
}

module.exports = { readMemory, writeMemory, deleteMemory, purgeAllMemory };