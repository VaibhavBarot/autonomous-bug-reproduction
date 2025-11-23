# BugBot - Autonomous Bug Reproduction System

An autonomous system that uses LLM reasoning and Playwright automation to reproduce UI bugs described in natural language.

### Recent Enhancements

- **LangChain-based 3‑phase workflow** in `@bugbot/agent`:
  - Planner (test plan generation), Executor (tool-using agent), Analyzer (final bug report / verification summary).
- **Gemini integration via `ChatGoogleGenerativeAI`** using **Gemini 2.x models** (default: `gemini-2.5-pro`).
- **Richer Playwright runner**:
  - More robust selector handling (text, role, and explicit `xpath=` selectors).
  - Simplified DOM extraction with better error handling.
  - Captures **backend logs** via Node.js DevTools (exposed through `/state` and `/backend-logs`).
  - Exposes a **BugBot Dashboard UI** (`/`) and **live status/log streaming** via SSE (`/logs`).
- **New LangChain tools** for the executor:
  - `navigate`, `click`, `input`, `get_dom`, `get_state`, `get_network`, `get_screenshot`, `get_backend_logs`.
- **CI / PR Verification Flow**:
  - GitHub webhook (`/github-webhook`) listens for PR events, spins up a **Daytona sandbox** on the PR branch, runs BugBot, and posts a **verification comment** back to the PR (bug still present vs likely solved).
  - Linear webhook (`/linear-webhook`) accepts Linear bug tickets and runs BugBot directly against the local test app.
  - PR ↔ Linear linking: when a PR title/branch contains a Linear ticket key (e.g. `AIE-5`), BugBot fetches the **full ticket description** from Linear and uses it as the bug description.
- **BugBot Dashboard** (non‑technical friendly):
  - Shows high‑level status, bug context (source, PR, branch, Linear ticket, description) and a human‑readable activity timeline.
  - Technical logs are still available behind a toggle for engineers.
- **Additional test bug scenarios** in the sample app:
  - Cart count not updating visually.
  - Simulated backend 500 error when adding **Product 2** (`CART_DB_ERROR`), allowing the agent to reason over backend logs.

## Architecture

The system consists of three main packages in a monorepo:

- **`packages/runner/`** - Playwright executor with REST API for browser control
- **`packages/agent/`** - LLM-driven reasoning loop for decision making
- **`packages/api/`** - Job orchestration, CLI, and report generation

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Google Gemini API key (recommended) or OpenAI API key
  - Get Gemini API key: https://aistudio.google.com/app/apikey
  - Set `GEMINI_API_KEY` environment variable (default) or `OPENAI_API_KEY` for OpenAI

### Installation

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Install Playwright browsers
npx playwright install chromium
```

### Usage

```bash
# Basic usage (uses Gemini by default)
# Note: Use -- to separate npm arguments from script arguments
npm run bugbot -- "When I add item to cart, cart count does not increase"

# With custom URL
npm run bugbot -- "Button click doesn't work" --url http://localhost:3000

# Run on different port (if 3001 is in use)
npm run bugbot -- "Bug description" --runner-url http://localhost:3002

# With options (Gemini - default)
npm run bugbot -- "Bug description" \
  --url http://localhost:4200 \
  --max-steps 30 \
  --headless \
  --api-key YOUR_GEMINI_KEY

# Using OpenAI instead
npm run bugbot -- "Bug description" \
  --provider openai \
  --api-key YOUR_OPENAI_KEY

# Or use npx directly (no -- needed)
npx -p @bugbot/api bugbot "Bug description" --api-key YOUR_KEY
```

### Options

- `-u, --url <url>` - Target URL to test (default: `http://localhost:3000`)
- `-r, --runner-url <url>` - Runner server URL (default: `http://localhost:3001`)
- `-s, --max-steps <number>` - Maximum steps to take (default: `20`)
- `-t, --timeout <seconds>` - Timeout in seconds (default: `300`)
- `--headless` - Run browser in headless mode
- `--api-key <key>` - API key (or set `GEMINI_API_KEY` or `OPENAI_API_KEY` env var)
- `--provider <provider>` - LLM provider: `gemini` (default) or `openai`

## How It Works

1. **Bug Ticket Input**: You provide a bug description in natural language.
2. **Planning Phase (PlannerAgent)**:
   - Uses Gemini (`gemini-2.5-pro` via `ChatGoogleGenerativeAI`) + LangChain structured output.
   - Produces a structured test plan (`steps[]` with `stepNumber`, `description`, `expectedOutcome`).
3. **Execution Phase (ExecutorAgent)**:
   - For each step, gathers context using LangChain tools:
     - `get_dom`, `get_state`, `get_network`, `get_screenshot`, and optionally `get_backend_logs`.
   - Sends a prompt (and context) to Gemini, which returns:
     - A **thought**, the chosen **tool** (`navigate`, `click`, `input`, `get_backend_logs`, or `noop`), and **args**.
   - Executes the chosen tool against the runner REST API and records observations.
4. **Analysis Phase (AnalyzerAgent)**:
   - Summarizes execution results, console errors, network activity, and (optionally) backend logs.
   - Determines whether the bug was reproduced and provides a root cause hypothesis and recommendations.
   - In **verification mode** (PR webhook), interprets results as either:
     - **Bug Still Present** – agent could reproduce the issue in the PR sandbox.
     - **Bug Likely Solved** – agent could not reproduce the issue in the PR sandbox.
5. **Report Generation (API package)**:
   - Produces `report.html` / `report.md` with:
     - Steps taken + LLM thoughts.
     - Observations (URL, title, clickable elements, etc.).
     - Network logs (HAR format).
     - Console errors.
     - Video recording and trace.
     - Reproduction result conclusion.

## Project Structure

```
/
├── packages/
│   ├── runner/          # Playwright executor with REST API
│   │   ├── src/
│   │   │   ├── server.ts              # Express REST server
│   │   │   ├── playwright-controller.ts  # Browser control
│   │   │   └── dom-simplifier.ts      # DOM extraction
│   │   └── package.json
│   ├── agent/           # LLM reasoning + LangChain workflow
│   │   ├── src/
│   │   │   ├── planner-agent.ts       # Planning agent (test plan generation)
│   │   │   ├── executor-agent.ts      # Execution agent (tool-using Gemini agent)
│   │   │   ├── analyzer-agent.ts      # Analysis & report agent
│   │   │   ├── tools/
│   │   │   │   └── playwright-tools.ts  # LangChain tools for runner REST API
│   │   │   ├── workflow.ts            # Orchestrates planner → executor → analyzer
│   │   │   ├── prompt.ts              # (Legacy agent prompt templates)
│   │   │   └── types.ts               # Shared TypeScript types
│   │   └── package.json
│   └── api/             # Orchestration and CLI
│       ├── src/
│       │   ├── cli.ts                 # CLI entrypoint
│       │   ├── orchestrator.ts        # Main control loop (used by CLI + webhooks)
│       │   ├── artifact-manager.ts    # Artifact capture
│       │   └── report-generator.ts    # Report generation
│       └── package.json
├── package.json         # Monorepo root
└── README.md
```

## Runner API Endpoints

The runner package exposes a REST API:

- `GET /` - BugBot Dashboard UI (live status + human‑readable activity timeline)
- `GET /logs` - Server-Sent Events (SSE) stream for live status + logs (consumed by the dashboard)
- `GET /health` - Health check (does **not** require Playwright to be initialized)
- `POST /init` - Initialize browser (body: `{ headless: boolean }`)
- `POST /navigate` - Navigate to URL (body: `{ url: string }`)
- `GET /dom` - Get simplified DOM elements
- `POST /action/click` - Click element (body: `{ selector: string }`)
- `POST /action/input` - Type text (body: `{ selector: string, text: string }`)
- `GET /network` - Get network entries
- `GET /screenshot` - Get base64 screenshot
- `GET /state` - Get browser state summary, including:
  - `url`, `title`, `consoleErrors`
  - recent `networkEntries`
  - recent `backendLogs` if DevTools logging is enabled
- `GET /backend-logs` - Direct access to recent backend logs
- `POST /stop` - Stop tracing (body: `{ tracingPath: string }`)
- `POST /close` - Close browser
- `POST /github-webhook` - GitHub PR webhook:
  - Verifies the HMAC signature using `GITHUB_WEBHOOK_SECRET`.
  - For `pull_request` events (`opened`, `synchronize`, `reopened`):
    - Spins up a **Daytona** sandbox on the PR branch.
    - Runs BugBot in **verification mode** against the sandbox.
    - Posts a verification comment back to the PR using `GITHUB_TOKEN`.
- `POST /linear-webhook` - Linear issue webhook:
  - Uses the Linear ticket title/description as the bug description.
  - Runs BugBot against the local test app (default: `http://localhost:4200`).

## Agent Action Format

The agent returns JSON actions:

```json
{
  "thought": "I need to click the Add to Cart button",
  "action": {
    "type": "click",
    "selector": "button:text('Add to cart')",
    "target": "Add to cart button"
  },
  "status": "in_progress"
}
```

When the bug is reproduced:

```json
{
  "thought": "The cart count did not increase after adding the item",
  "action": { ... },
  "status": "reproduced",
  "reason": "Cart count remained at 0 after clicking Add to Cart"
}
```

## Reports

Reports are saved to `runs/<timestamp>/` directory:

- `report.html` - Visual HTML report with steps, screenshots, and artifacts
- `report.md` - Markdown version of the report
- `trace.zip` - Playwright trace file (can be opened with `npx playwright show-trace`)
- `network.har` - Network traffic in HAR format
- `console.log` - Console errors and logs
- `videos/` - Video recording of the session

## Example Workflow

### Using the Test App

```bash
# 1. Start the test app (includes frontend + backend)
cd test-app
./start.sh
# Or manually:
# Terminal 1: cd test-app/backend && npm install && npm start
# Terminal 2: cd test-app/frontend && npm install && npm start

# 2a. Run BugBot to reproduce the "cart count does not increase" bug
cd ..
npm run bugbot "When I add item to cart, cart count does not increase" \
  --url http://localhost:4200 \
  --api-key YOUR_GEMINI_KEY

# 2b. Run BugBot against the backend 500 bug for Product 2
npm run bugbot "When I add Product 2 to the cart, the backend returns a 500 error. Check backend logs for CART_DB_ERROR." \
  --url http://localhost:4200 \
  --api-key YOUR_GEMINI_KEY

# 3. Check the latest report
open runs/run-*/report.html
```

### Using Your Own App

```bash
# 1. Start your application (in another terminal)
cd your-app
npm start  # Runs on http://localhost:3000

# 2. Run BugBot
npx bugbot "When I click the login button, nothing happens"

# 3. Check the report
open runs/run-1234567890/report.html
```

### Running in a Daytona Sandbox (PR Verification Flow)

BugBot can also run against an app that is started inside a **Daytona sandbox** instead of your local machine.
This is wired into the GitHub webhook so that every PR can be tested in an isolated environment.

Requirements:

- `DAYTONA_API_KEY` – API key for the Daytona TypeScript SDK.
- Your app must be in a Git repo that can be cloned from inside the sandbox.
- `GITHUB_WEBHOOK_SECRET` – shared secret configured in the GitHub webhook.
- `GITHUB_TOKEN` – personal access token with `repo` permissions (for posting PR comments).
- Optionally, `LINEAR_API_KEY` if you want BugBot to enrich the bug description from Linear issues.

High level flow:

1. GitHub sends a `pull_request` webhook → `/github-webhook`.
2. Runner verifies the signature and spins up a **Daytona sandbox** on the PR branch.
3. BugBot runs in **verification mode** against the sandbox URL.
4. BugBot posts a **verification report comment** back to the PR:
   - ✅ **Bug Likely Solved** – agent could not reproduce the bug.
   - ⚠️ **Bug Still Present** – agent could reproduce the bug.

## Development

### Building

```bash
npm run build
```

### Running Individual Packages

```bash
# Runner server
cd packages/runner
npm run dev

# CLI
cd packages/api
npm run dev "bug description"
```

## Limitations & Future Improvements

This is a hackathon MVP with the following limitations:

- Simple DOM extraction (no true deep visual reasoning; screenshots are captured but multimodal input is currently disabled for stability)
- Basic action set (click, input, navigate, inspect network/backend logs)
- No support for complex interactions (drag & drop, file uploads, etc.)
- Limited error recovery
- Daytona integration is currently focused on the **GitHub PR verification** flow (not yet exposed via CLI flags)

Future improvements could include:
- Visual element detection using screenshots / multimodal Gemini models
- More action types (scroll, hover, etc.)
- Better error handling and retry logic
- Richer Daytona configuration via CLI (multiple apps, multi-port setups)
- Support for multiple browsers
- Parallel test execution

## License

MIT

