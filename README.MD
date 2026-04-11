# SAP Vision Agent 🤖👁️

An autonomous, self-healing Robotic Process Automation (RPA) agent for SAP WebGUI. Built with Node.js and Playwright, this agent leverages local Vision-Language Models (VLMs) via Ollama to dynamically navigate SAP environments, overcoming the notorious challenge of dynamic/ephemeral HTML IDs. 

This project implements a **Finite State Machine (FSM)** to achieve Level 5 autonomy, allowing the bot to organically train, test, execute, and self-heal without human micromanagement.

## ✨ Key Features

* **🎛️ FSM Google Sheets Orchestration:** The FSM is entirely controlled via Google Sheets. Tasks cycle through explicit states:
  * `Needs Training`: Flushes the memory cache and forces the agent to map the UI using AI/Human logic.
  * `Testing`: Runs a strict autonomous unit test. If successful, it promotes itself to Production.
  * `Production`: Silent, lightning-fast execution using zero-token cached memory. 
  * `Broken`: If a production run crashes (e.g., SAP updates its UI), the bot automatically demotes the task to `Broken` and drops back into training mode on the next run.
* **🛡️ Multi-Layered Locator Shields:**
  * **The Ultimate Input Shield:** Actively validates that the AI (or cached memory) selected a typeable `<input>` field, safely rejecting buttons (`<div>`) or labels to prevent fatal crashes.
  * **The Anti-Duplicate Shield:** Mathematically tracks mapped fields during a session, preventing the AI from accidentally assigning the same UI box to multiple variables.
* **⚡ AI Circuit Breaker:** Vision AI is computationally expensive. If the AI guesses an invalid field twice in a row, the bot trips a "circuit breaker," bypassing the VLM entirely to save GPU time and instantly dropping to manual Human-in-the-Loop mode.
* **🧠 Zero-Token Memory & Granular Self-Healing:** Stores permanent HTML IDs locally (`skill.json`). If a single field breaks, the bot does *not* suffer from "amnesia" (wiping the whole file). It surgically re-learns only the broken field, preserving the rest of its memory.
* **🎯 Set-of-Mark (SoM) Injection:** If the cache misses, the agent injects a numbered bounding-box overlay into the SAP iframe, allowing the AI or Human to select the correct UI element by number.
* **🙋‍♂️ Human-in-the-Loop (HITL):** Safely pauses execution and prompts the human via the terminal to map elements if the AI circuit breaker trips.
* **📊 Date-Anchor ALV Scraper & Auto-Skill Analysis:** Flattens SAP's vertically-rendered `input readonly` ALV grids into perfect horizontal rows. It then dynamically generates and injects a `skill.md` prompt, using a secondary text LLM to instantly audit and output pure JSON business data.

## 📂 Project Structure

```text
sap-vision-agent/
├── agent.js              # The main FSM Orchestrator script
├── helpers/              # Core utilities
│   ├── dom.js            # Omni-frame locators and SoM injection
│   ├── human.js          # HITL terminal prompts
│   ├── logger.js         # Timezone-aware, self-cleaning logging
│   ├── memory.js         # JSON caching logic (readSkill, writeSkill, purgeSkill)
│   ├── sheet.js          # Google Sheets API FSM integration
│   └── vision.js         # Optimized Ollama Vision API requests
├── tcodes/               # Application-specific logic plugins
│   └── st22.js           # Example logic for checking Short Dumps
├── skills/               # (Auto-generated) Memory banks and Skill.md prompts
├── downloads/            # (Auto-generated) Extracted raw text feeds and JSON analysis
├── screenshots/          # (Auto-generated) Current run visuals
├── .env                  # Environment configuration (ignored in git)
├── google-credentials.json # GCP Service Account key (ignored in git)
└── package.json
```

## 🚀 Prerequisites

1. **Node.js** (v18+)
2. **Playwright** (`npx playwright install chromium`)
3. **Ollama** running locally or on your network, with a Vision model (e.g., `gemma4:e2b`) and a Text model (e.g., `gemma`) pulled.
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

To run the agent, simply execute the orchestrator script. The FSM will automatically read the state from the Google Sheet and take the appropriate action (Train, Test, or Execute):

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

## 🏗️ How to add new T-Codes

The agent is designed to scale effortlessly using a modular plugin system. To add automation for a new transaction (e.g., `SU01`):
1. Add `SU01` to your Google Sheet queue and set the state to `Needs Training`.
2. Create a new file at `tcodes/su01.js`.
3. Export an asynchronous function that leverages the locator engine (`getFieldLocator`) and ALV scraper logic. The Orchestrator will handle the FSM states, login, fast URL navigation, and self-healing.
```