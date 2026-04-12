# SAP Vision Agent 🤖👁️

An autonomous, self-healing Robotic Process Automation (RPA) agent for both legacy SAP WebGUI and modern SAP UI5/Fiori applications. Built with Node.js and Playwright, this agent leverages local Vision-Language Models (VLMs) via Ollama to dynamically navigate complex SAP environments, overcoming the notorious challenges of dynamic/ephemeral HTML IDs and aggressive frontend re-rendering.

This project implements a **Finite State Machine (FSM)** to achieve Level 5 autonomy, allowing the bot to organically train, test, execute, and self-heal without human micromanagement. It also features a real-time **Telegram ChatOps Gateway**, allowing you to command, monitor, and receive artifacts from the agent directly from your phone.

## 🎬 See it in Action

### 1\. Interactive Training Phase (AI Vision & Context Switching)

*Watch the agent inject Set-of-Mark (SoM) boxes to visually map the legacy SAP DOM using AI, and then seamlessly switch to pure native Playwright locators for the modern UI5 app.*

### 2\. Headless Batch Execution (Zero-Token Memory)

*Once trained, the agent relies entirely on its `skill.json` cache. Watch it fly through the legacy transaction and UI5 app entirely in the background, without requiring AI inference or rendering visual boxes.*

-----

## ✨ Key Features

  * **🎛️ Universal Mega-Sheet FSM Orchestrator:** The FSM is entirely controlled via a dynamic Google Sheet. Tasks cycle through explicit states:
      * `Needs Training`: Flushes the memory cache and forces the agent to map the UI using AI/Human logic.
      * `Testing`: Runs a strict autonomous unit test. If successful, it promotes itself to Production.
      * `Production`: Silent, lightning-fast execution using zero-token cached memory or pure native locators.
      * `Broken`: If a production run crashes (e.g., SAP updates its UI), the bot automatically demotes the task to `Broken`, captures a phase-specific crash screenshot, and drops back into training mode on the next run.
  * **💬 Enterprise ChatOps Gateway:** A decoupled event-driven Telegram server that streams real-time execution logs, formats dynamic AI summaries, and automatically uploads crash screenshots and generated JSON artifacts straight to your mobile device.
  * **🛤️ Dynamic URL Routing & Payload Injection:** The Orchestrator automatically parses dynamic headers from Row 1. It seamlessly routes both legacy WebGUI T-Codes and direct UI5 URLs, passing the entire row's data as a JSON payload (`taskData`) to your scripts for highly parameterized runs.
  * **🛡️ Multi-Layered Locator Shields:** Actively validates that the AI selected typeable `<input>` fields and detects if a modern framework (like UI5) asynchronously re-renders and destroys target elements while the AI is thinking.
  * **⚡ Global AI Circuit Breaker:** If the AI fails cumulatively across a transaction, the bot trips a global circuit breaker, bypassing the VLM for the rest of the run and dropping to manual Human-in-the-Loop mode (if running interactively) or gracefully aborting (if running headlessly).
  * **🧬 Adaptive Phase-Gate Architecture:** Intelligently switches execution strategies based on the target environment (Legacy Visual AI vs. Modern Native Locators).

## 📂 Project Structure

```text
sap-vision-agent/
├── agent.js              # The main FSM Orchestrator script
├── gateway.js            # The Telegram ChatOps server (Real-time listener)
├── helpers/              # Core utilities
│   ├── dom.js            # Omni-frame locators and SoM injection
│   ├── human.js          # HITL terminal prompts & headless failsafes
│   ├── logger.js         # Timezone-aware, self-cleaning logging
│   ├── skill.js          # JSON caching logic (readSkill, writeSkill, purgeSkill)
│   ├── sheet.js          # Google Sheets API Mega-Sheet parsing
│   ├── vision.js         # Optimized Ollama Vision API requests
│   └── telegram.js       # The ChatOps adapter (Markdown formatting, limits, buttons)
├── tasks/                # Application-specific logic plugins (Directory-based)
│   ├── st22/             
│   │   └── st22.js       # Legacy WebGUI task: AI Vision & Extractor logic
│   └── ui5_wizard/       
│       └── ui5_wizard.js # Modern UI5 task: Phase-Gate & Native Locators
├── skills/               # (Auto-generated) Memory banks and Skill.md prompts
├── downloads/            # (Auto-generated) Extracted raw text feeds and JSON analysis
├── screenshots/          # (Auto-generated) Current run visuals & crash reports
├── logs/                 # Standard output logs for Headless/Cron execution
├── demo/                 # Presentation GIFs for GitHub README
├── .env                  # Environment configuration (ignored in git)
└── package.json
```

## 📊 Google Sheet Structure (The Mega-Sheet)

Your Google Sheet drives the Orchestrator. The headers in Row 1 are mapped dynamically to the `taskData` object injected into your scripts.

| Task Name (Col A) | Skill State (Col B) | Target (Col C) | Complete/Error | Timestamp | Product Type | Product Name | Product Weight |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `st22` | Production | `ST22` | 0 short dumps found. | 4/12/2026, 7:25 AM | | | |
| `ui5_wizard` | Production | `http://<ip>/index.html` | Completed | 4/12/2026, 7:25 AM | Mobile | TEST03 | 123 |

## ⚙️ Installation & Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/nungbin/sap-vision-agent.git
    cd sap-vision-agent
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    npm install node-telegram-bot-api
    npx playwright install chromium
    npx playwright install-deps # Required for headless Linux environments
    ```

3.  **Configure Environment Variables:**
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

    # ChatOps Gateway Configuration
    TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
    STT_TTS_URL="http://YOUR_STT_IP:3000" # Optional: For voice microservices

    # Logging Preferences
    LOG_TIMEZONE="America/Edmonton"

    # Execution Mode
    HEADLESS="TRUE" # Set to FALSE for local development
    ```

## 📱 Setting up the Telegram ChatOps Bot

To control the agent from your phone, you need to register a bot with Telegram's BotFather:

1.  Open Telegram and search for **@BotFather** (look for the verified blue checkmark).
2.  Start the chat and send the command: `/newbot`
3.  Give your bot a display name (e.g., `SAP Vision Agent`).
4.  Give your bot a unique username ending in "bot" (e.g., `sap_hpa6_bot`).
5.  BotFather will provide an **HTTP API Token**. Treat this like a password and paste it into your `.env` file under `TELEGRAM_BOT_TOKEN`.
6.  *(Optional)* Send `/mybots` to BotFather, select your bot -\> Bot Settings -\> Group Privacy -\> **Turn Off**. This allows the bot to listen to natural language in team chats.

## 💻 Usage & Execution Modes

The bot dynamically adapts to your deployment environment.

### 1\. Interactive Mode (Local Development & Training)

When building new skills or overriding broken ones, run the bot interactively. This pops open the browser, enables Human-in-the-Loop (`askHuman`) terminal prompts, and allows you to watch the agent learn.

```bash
HEADLESS=false VERBOSE=true node agent.js
```

### 2\. Headless Mode (Cloud / Production / Crontab)

For unattended batch processing, run the bot headlessly. The agent will automatically bypass `askHuman` prompts to prevent infinite hangs and will write all crash diagnostics to the `screenshots/` directory.

```bash
HEADLESS=true node agent.js
```

### 3\. ChatOps Mode (Telegram Gateway)

Leave the gateway running to create an always-on listener that bridges Telegram to your CLI. It spawns headless `child_process` jobs and streams the terminal output live to your phone.

```bash
node gateway.js
```

  * **`/list`** - Dynamically scans your `tasks/` directory and shows available workflows.
  * **`/run [task]`** - Spawns the task, streams live log updates directly into the chat bubble, and gracefully handles successes, summaries, or screenshot crash reporting.

## 🔌 The Adapter Pattern (Telegram Helper)

The project utilizes an Adapter Pattern (`helpers/telegram.js`) to completely decouple the presentation layer from the SAP business logic.

  * The core scripts (e.g., `st22.js`) simply broadcast massive text summaries and file paths to the terminal via `[GATEWAY_SUMMARY]` and `[GATEWAY_ARTIFACT]` tags.
  * The Telegram Adapter intercepts these strings, converts terminal line breaks, truncates data to fit Telegram's strict 4,096 character limit, and injects interactive callback buttons—ensuring the engine runs flawlessly regardless of whether it's talking to Telegram, Google Chat, or Slack.

## ⏳ Headless Background Scheduling (Crontab-UI)

To run the agent autonomously in a Linux LXC or cloud container, we use `crontab-ui` as our background scheduler.

**1. Install Crontab-UI Globally:**

```bash
npm install -g crontab-ui
```

**2. Start the Web Dashboard:**
Bind it to `0.0.0.0` so you can access the dashboard over your local network:

```bash
HOST=0.0.0.0 crontab-ui
```

*(Access via browser at `http://<your-server-ip>:8000`)*

**3. Configure the Cron Job:**
Create a new job in the dashboard using absolute paths to ensure the environment initializes correctly. Append the output to a log file:

  * **Command:** `cd /home/YOUR_USER/projects/sap_agent && /usr/bin/node agent.js >> logs/cron.log 2>&1`
  * **Schedule:** `*/5 * * * *` (Every 5 minutes, or schedule it to run once on demand)

**4. Real-Time Log Monitoring:**
Because the browser is hidden, you can monitor the bot's live thoughts and actions by "tailing" the log file via your SSH terminal:

```bash
tail -f /home/YOUR_USER/projects/sap_agent/logs/cron.log
```

## 🏗️ How to Add New Tasks (Directory Structure)

1.  **Update the Mega-Sheet:** Add a new row to your Google Sheet. Set the *Task Name* (e.g., `su01`), the *Skill State* (`Needs Training`), the *Target* (the T-Code or URL), and any dynamic payload columns you need.
2.  **Create the Folder & Script:** Create a new folder inside the `tasks/` directory matching the Task Name exactly, and place your script inside (e.g., `tasks/su01/su01.js`).
3.  **Build the Logic:** Export an asynchronous function that receives the `page` and `helpers` object. Use `helpers.taskData` to unpack your custom Sheet columns.
4.  **Execute:** The Orchestrator and Gateway will seamlessly handle the FSM states, system login, URL routing, payload injection, dynamic ChatOps reporting, and self-healing.