# SAP Vision Agent 🤖👁️

An autonomous, self-healing Robotic Process Automation (RPA) agent for SAP WebGUI. Built with Node.js and Playwright, this agent leverages local Vision-Language Models (VLMs) via Ollama to dynamically navigate SAP environments, overcoming the notorious challenge of dynamic/ephemeral HTML IDs.

## ✨ Key Features

* **🧠 Self-Healing Architecture:** The agent generates its own Playwright "skills" once it learns how to navigate to a specific Transaction Code (T-Code). If SAP changes its UI and the skill breaks, the agent automatically deletes the broken skill and falls back to Vision AI to re-learn the new layout.
* **👀 Vision AI Fallback:** Integrates with local VLMs (like Gemma or Qwen via Ollama) to visually identify input fields and buttons based on raw screenshots, without relying on hardcoded DOM selectors.
* **🎯 Set-of-Mark (SoM) Injection:** If the raw vision prompt fails, the agent automatically injects a numbered bounding-box overlay into the SAP iframe, allowing the AI to easily select the correct UI element by number.
* **🙋‍♂️ Human-in-the-Loop (HITL):** If the AI completely fails to find a valid, editable input field, the script safely pauses execution and prompts the human via the terminal to provide the correct box number, subsequently learning from the human's input.
* **🧩 Modular Plugin System:** Pure Orchestrator design. Navigation logic is separated from application logic. Once the agent navigates to a T-Code, it dynamically loads specific execution scripts from the `tcodes/` directory.

## 📂 Project Structure

```text
sap-vision-agent/
├── agent.js              # The main Orchestrator script
├── helpers/              # Core utilities
│   ├── dom.js            # Omni-frame locators and SoM injection
│   ├── human.js          # HITL terminal prompts
│   ├── logger.js         # Timezone-aware, self-cleaning logging
│   ├── skills.js         # Auto-generates Playwright skill scripts
│   └── vision.js         # API integration with Ollama
├── tcodes/               # Application-specific logic plugins
│   └── st22.js           # Example logic for checking Short Dumps
├── skills/               # (Auto-generated) Learned navigation scripts
├── logs/                 # (Auto-generated) Execution logs
├── screenshots/          # (Auto-generated) Current run visuals
├── .env                  # Environment configuration (ignored in git)
└── package.json
```

## 🚀 Prerequisites

1. **Node.js** (v18+)
2. **Playwright** (`npx playwright install chromium`)
3. **Ollama** running locally or on your network, with a Vision model pulled (e.g., `ollama run gemma4:e2b --keepalive -1m`)
4. Access to an **SAP WebGUI** instance.

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/nungbin/sap-vision-agent.git](https://github.com/nungbin/sap-vision-agent.git)
   cd sap-vision-agent
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   # SAP Credentials
   SAP_WEBGUI_URL="http://YOUR_SAP_IP:PORT/sap/bc/gui/sap/its/webgui?sap-client=001&sap-language=EN"
   SAP_USER="your_username"
   SAP_PASS="your_password"

   # Ollama Vision Configuration
   OLLAMA_URL="http://YOUR_OLLAMA_IP:11434/api/generate"
   OLLAMA_MODEL="gemma4:e2b" # Or whichever vision model you are using

   # Logging Preferences
   LOG_TIMEZONE="America/Edmonton"
   LOG_RETENTION_DAYS=7
   ```

## 💻 Usage

To run the agent, simply execute the orchestrator script:

```bash
node agent.js
```

**For verbose debugging (shows raw AI JSON responses):**
```bash
VERBOSE=true node agent.js
```

## 🏗️ How to add new T-Codes

The agent is designed to scale effortlessly. To add automation for a new transaction (e.g., `SU01`):
1. Open `agent.js` and change `const TARGET_TCODE = "SU01";` (or pass it in dynamically).
2. Create a new file at `tcodes/su01.js`.
3. Export an asynchronous function that contains your Playwright logic for that specific screen. The Orchestrator will handle the login, the vision navigation, and the self-healing, and will dynamically pass the active `page` object to your new script once the UI is ready!
```

***

### How to push this to GitHub:
1. `nano README.md` -> Paste the code above -> Save and Exit (`Ctrl+O`, `Enter`, `Ctrl+X`).
2. Run `git add README.md`
3. Run `git commit -m "Add project README"`
4. Run `git push`

This is an incredible piece of engineering to show off on your profile!