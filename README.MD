# SAP Vision Agent 🤖👁️

An autonomous, self-healing Robotic Process Automation (RPA) agent for both legacy SAP WebGUI and modern SAP UI5/Fiori applications. Built with Node.js and Playwright, this agent leverages local Vision-Language Models (VLMs) via Ollama to dynamically navigate complex SAP environments, overcoming the notorious challenges of dynamic/ephemeral HTML IDs and aggressive frontend re-rendering. 

This project implements a **Finite State Machine (FSM)** to achieve Level 5 autonomy, allowing the bot to organically train, test, execute, and self-heal without human micromanagement.

## ✨ Key Features

* **🎛️ Universal Mega-Sheet FSM Orchestrator:** The FSM is entirely controlled via a dynamic Google Sheet. Tasks cycle through explicit states:
  * `Needs Training`: Flushes the memory cache and forces the agent to map the UI using AI/Human logic.
  * `Testing`: Runs a strict autonomous unit test. If successful, it promotes itself to Production.
  * `Production`: Silent, lightning-fast execution using zero-token cached memory or pure native locators. 
  * `Broken`: If a production run crashes (e.g., SAP updates its UI), the bot automatically demotes the task to `Broken`, captures a phase-specific crash screenshot, and drops back into training mode on the next run.
* **🛤️ Dynamic URL Routing & Payload Injection:** The Orchestrator automatically parses dynamic headers from Row 1. It seamlessly routes both legacy WebGUI T-Codes (via `&~transaction=`) and direct UI5 URLs, passing the entire row's data as a JSON payload (`taskData`) to your scripts for highly parameterized runs.
* **🛡️ Multi-Layered Locator Shields:**
  * **The Ultimate Input Shield:** Actively validates that the AI (or cached memory) selected a typeable `<input>` field, safely rejecting buttons (`<div>`) or labels to prevent fatal crashes.
  * **DOM Validation Shield:** Detects if a modern framework (like UI5) asynchronously re-renders and destroys target elements while the AI is thinking, safely rejecting the hallucinated target.
* **⚡ Global AI Circuit Breaker:** Vision AI is computationally expensive. If the AI fails cumulatively across a transaction (e.g., empty guesses, duplicate targets, or targeting vanished DOM elements), the bot trips a global circuit breaker, bypassing the VLM for the rest of the run and dropping to manual Human-in-the-Loop mode.
* **🧬 Adaptive Phase-Gate Architecture:** Intelligently switches execution strategies based on the target environment:
  * **Legacy SAP WebGUI:** Uses Set-of-Mark (SoM) visual injection and Vision AI to navigate cluttered, opaque DOMs.
  * **Modern SAP UI5:** Uses pure native Playwright locators to bypass aggressive asynchronous re-renders and live-validation engines that would otherwise destroy visual SoM boxes.
* **🧠 Zero-Token Memory & Granular Self-Healing:** Stores permanent HTML IDs locally (`skills/`). If a single field breaks, the bot surgically re-learns only the broken field, preserving the rest of its memory.
* **🙋‍♂️ Human-in-the-Loop (HITL):** Safely pauses execution and prompts the human via the terminal to map elements if the AI circuit breaker trips.
* **📊 Auto-Skill Analysis:** Extracts raw structured feeds from SAP and dynamically generates `skill.md` prompts, using a secondary text LLM to instantly audit and output pure JSON business data.

## 📂 Project Structure

```text
sap-vision-agent/
├── agent.js              # The main FSM Orchestrator script
├── helpers/              # Core utilities
│   ├── dom.js            # Omni-frame locators and SoM injection
│   ├── human.js          # HITL terminal prompts
│   ├── logger.js         # Timezone-aware, self-cleaning logging
│   ├── skill.js          # JSON caching logic (readSkill, writeSkill, purgeSkill)
│   ├── sheet.js          # Google Sheets API Mega-Sheet & Dynamic Header parsing
│   └── vision.js         # Optimized Ollama Vision API requests
├── tasks/                # Application-specific logic plugins (Legacy & Modern)
│   ├── st22.js           # Legacy WebGUI task: AI Vision & Extractor logic
│   └── ui5_wizard.js     # Modern UI5 task: Phase-Gate & Native Locators
├── skills/               # (Auto-generated) Memory banks and Skill.md prompts
├── downloads/            # (Auto-generated) Extracted raw text feeds and JSON analysis
├── screenshots/          # (Auto-generated) Current run visuals & Phase-Gate crash reports
├── .env                  # Environment configuration (ignored in git)
├── google-credentials.json # GCP Service Account key (ignored in git)
└── package.json
```

## 📊 Google Sheet Structure (The Mega-Sheet)

Your Google Sheet drives the Orchestrator. The headers in Row 1 are mapped dynamically to the `taskData` object injected into your scripts.

| Task Name (Col A) | Skill State (Col B) | Target (Col C) | Complete/Error | Timestamp | Product Type | Product Name | Product Weight |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `st22` | Production | `ST22` | 0 short dumps found. | 4/11/2026, 2:51 PM | | | |
| `ui5_wizard` | Needs Training | `http://<ip>/index.html` | | | Mobile | TEST_BOT | 999 |

* **Task Name:** Must perfectly match the `.js` filename inside your `tasks/` folder.
* **Skill State:** Controls the FSM (`Needs Training`, `Testing`, `Production`, `Broken`).
* **Target:** Drives the browser URL. Can be a legacy T-Code (`ST22`) or a direct URL (`http://...`).
* **Custom Columns:** Any column headers added after the core operational columns (like *Product Type*, *Product Name*) are instantly accessible in your scripts via `taskData.productType`.

## 🚀 Prerequisites

1. **Node.js** (v18+)
2. **Playwright** (`npx playwright install chromium`)
3. **Ollama** running locally or on your network, with a Vision model (e.g., `gemma4:e2b`) and a Text model (e.g., `gemma`) pulled.
4. Access to an **SAP WebGUI** or **SAP UI5** instance.
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

To run the agent, simply execute the orchestrator script. The FSM will automatically read the state from the Google Sheet, apply dynamic URL routing, and take the appropriate action:

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

## 🏗️ How to Add New Tasks (T-Codes & UI5)

The agent is designed to scale effortlessly using a modular plugin system. To add automation for a new process (e.g., `SU01` or a custom Fiori App):

1. **Update the Mega-Sheet:** Add a new row to your Google Sheet. Set the *Task Name* (e.g., `su01`), the *Skill State* (`Needs Training`), the *Target* (the T-Code or URL), and any dynamic payload columns you need.
2. **Create the Script:** Create a new file inside the `tasks/` directory matching the Task Name exactly (e.g., `tasks/su01.js`).
3. **Build the Logic:** Export an asynchronous function that receives the `page` and `helpers` object. Use `helpers.taskData` to unpack your custom Sheet columns. 
4. **Execute:** The Orchestrator will seamlessly handle the FSM states, system login, URL routing, payload injection, and self-healing.
