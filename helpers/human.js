const readline = require('readline');

const askHuman = (query) => {
    // Determine if we are running in headless mode (defaulting to true for safety in cloud environments)
    const isHeadless = process.env.HEADLESS ? process.env.HEADLESS.toUpperCase() === 'TRUE' : true;

    if (isHeadless) {
        console.log("⚠️ askHuman called in Headless mode. Bypassing prompt to prevent infinite hang.");
        return Promise.resolve(null);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
};

module.exports = { askHuman };