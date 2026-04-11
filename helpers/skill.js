const fs = require('fs');
const path = require('path');

function getSkillPath(tcode) {
    const dir = path.join(__dirname, '..', 'skills', tcode.toUpperCase());
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'skill.json');
}

module.exports = {
    readSkill: (tcode, key) => {
        const filePath = getSkillPath(tcode);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath));
            return data[key] || null;
        }
        return null;
    },
    writeSkill: (tcode, key, value) => {
        const filePath = getSkillPath(tcode);
        let data = {};
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath));
        }
        data[key] = value;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
    purgeSkill: (tcode) => {
        const filePath = getSkillPath(tcode);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }
};