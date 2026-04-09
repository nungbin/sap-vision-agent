# SAP Vision Agent 🤖👁️

An autonomous, self-healing Robotic Process Automation (RPA) agent for SAP WebGUI. Built with Node.js and Playwright, this agent leverages local Vision-Language Models (VLMs) via Ollama to dynamically navigate SAP environments, overcoming the notorious challenge of dynamic/ephemeral HTML IDs.

## ✨ Key Features

* **📊 Google Sheets Orchestration:** Acts as the central command. The agent reads a queue of T-Codes to execute directly from a Google Sheet and writes back real-time status updates and timestamps.
* **🧠 Zero-Token Memory Caching:** Once the agent learns a UI element (like a complex grid or command box), it permanently caches the exact HTML ID into a local JSON memory bank. Future runs execute in milliseconds with zero AI compute cost.
* **👀 Vision AI Fallback:** Integrates with local VLMs (like Gemma via Ollama) to visually identify input fields and buttons based on raw screenshots if the SAP UI changes and the memory cache breaks.
* **🎯 Set-of-Mark (SoM) Injection:** If the raw vision prompt fails, the agent automatically injects a numbered bounding-box overlay into the SAP iframe, allowing the AI to easily select the correct UI element by number.
* **🙋‍♂️ Human-in-the-Loop (HITL):** For excessively dense grids that confuse smaller AI models, the script safely pauses execution and prompts the human via the terminal to map the elements once, caching them forever.
* **🧩 Modular Plugin System:** Navigation logic is separated from business logic. Once the agent navigates to a T-Code, it dynamically loads specific execution scripts from the `tcodes/` directory.

## 📂 Project Structure

```text
sap-vision-agent/
├── agent.js              # The main Orchestrator script
├── helpers/              # Core utilities
│   ├── dom.js            # Omni-frame locators and SoM injection
│   ├── human.js          # HITL terminal prompts
│   ├── logger.js         # Timezone-aware, self-cleaning logging
│   ├── memory.js         # Zero-token JSON caching and self-healing logic
│   ├── sheet.js          # Google Sheets API integration
│   └── vision.js         # API integration with Ollama
├── tcodes/               # Application-specific logic plugins
│   └── st22.js           # Example logic for checking Short Dumps
├── skills/               # (Auto-generated) JSON memory banks for T-Codes
├── logs/                 # (Auto-generated) Execution logs
├── screenshots/          # (Auto-generated) Current run visuals
├── .env                  # Environment configuration (ignored in git)
├── google-credentials.json # GCP Service Account key (ignored in git)
└── package.json
```

## 🚀 Prerequisites

1. **Node.js** (v18+)
2. **Playwright** (`npx playwright install chromium`)
3. **Ollama** running locally or on your network, with a Vision model pulled.
4. Access to an **SAP WebGUI** instance.
5. A **Google Cloud Service Account** with access to a Google Sheet.

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
   OLLAMA_MODEL="gemma4:e2b" 

   # Google Sheets Configuration
   GOOGLE_SHEET_ID="your_google_sheet_id_here"
   GOOGLE_APPLICATION_CREDENTIALS="./google-credentials.json"

   # Logging Preferences
   LOG_TIMEZONE="America/Edmonton"
   LOG_RETENTION_DAYS=7
   ```

## 💻 Usage

To run the agent, simply execute the orchestrator script:

```bash
node agent.js
```

**For displaying more information:**
```bash
VERBOSE=true node agent.js
```

**For debugging (preserves screenshots and captures pre-execution form snapshots):**
```bash
DEBUG=TRUE node agent.js
```

*Note: You can force the agent to wipe its memory for a specific T-Code and re-learn the UI by checking the "Overwrite" box in Column B of your Google Sheet!*

## 🏗️ How to add new T-Codes

The agent is designed to scale effortlessly. To add automation for a new transaction (e.g., `SU01`):
1. Add `SU01` to Column A of your Google Sheet.
2. Create a new file at `tcodes/su01.js`.
3. Export an asynchronous function that contains your Playwright logic for that specific screen. The Orchestrator will handle the login, navigation, and self-healing, and will dynamically pass the active `page` object to your new script once the UI is ready!
```

---

### How to commit and push this to GitHub:

1. Open your `README.md` file in VS Code.
2. Paste the updated code above and save the file.
3. In your terminal, run:
   ```bash
   git add README.md
   git commit -m "Update README with Google Sheets Orchestrator and JSON Memory architecture"
   git push
   ```