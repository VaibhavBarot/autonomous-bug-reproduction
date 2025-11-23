# BugBot - Autonomous Bug Reproduction System

An autonomous system that uses LLM reasoning and Playwright automation to reproduce UI bugs described in natural language.

### Recent Enhancements

- **LangChain-based 3‑phase workflow** in `@bugbot/agent`:
  - Planner (test plan generation), Executor (tool-using agent), Analyzer (final bug report).
- **Gemini integration via `ChatGoogleGenerativeAI`** using `gemini-2.5-flash`.
- **Richer Playwright runner**:
  - More robust selector handling (text, role, and explicit `xpath=` selectors).
  - Simplified DOM extraction with better error handling.
  - Captures **backend logs** via Node.js DevTools (exposed through `/state` and `/backend-logs`).
- **New LangChain tools** for the executor:
  - `navigate`, `click`, `input`, `get_dom`, `get_state`, `get_network`, `get_screenshot`, `get_backend_logs`.
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
   - Uses Gemini (`gemini-2.5-flash` via `ChatGoogleGenerativeAI`) + LangChain structured output.
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
│       │   ├── orchestrator.ts        # Main control loop
│       │   ├── artifact-manager.ts    # Artifact capture
│       │   └── report-generator.ts    # Report generation
│       └── package.json
├── package.json         # Monorepo root
└── README.md
```

## Runner API Endpoints

The runner package exposes a REST API:

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

### Running the App in a Daytona Sandbox

BugBot can also run against an app that is started inside a **Daytona sandbox** instead of your local machine.
This is useful for ephemeral environments, CI, or when you want a clean, isolated dev workspace.

Requirements:

- Set `DAYTONA_API_KEY` (and optionally `DAYTONA_API_URL`, `DAYTONA_TARGET`) for the Daytona TypeScript SDK.
- Your app must be in a Git repo that can be cloned from inside the sandbox.

Example (app on `main` branch, running on port 3000):

```bash
DAYTONA_API_KEY=... \
bugbot "When I click the login button, nothing happens" \
  --daytona \
  --daytona-repo https://github.com/your-org/your-app.git \
  --daytona-port 3000
```

You can customize how the app is started:

- `--daytona-branch <branch>` – Git branch to clone (default: `main`)
- `--daytona-project-path <path>` – Path inside the repo where the app lives (e.g. `apps/frontend`)
- `--daytona-install-command <cmd>` – Install command (default: `npm install`)
- `--daytona-start-command <cmd>` – Start command (default: `npm start`)

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

- Simple DOM extraction (no true deep visual reasoning; screenshots are captured but not yet fed into the LLM)
- Basic action set (click, input, navigate, inspect network/backend logs)
- No support for complex interactions (drag & drop, file uploads, etc.)
- Limited error recovery
- No Daytona integration (designed for local development)

Future improvements could include:
- Visual element detection using screenshots / multimodal Gemini models
- More action types (scroll, hover, etc.)
- Better error handling and retry logic
- Daytona ephemeral environment integration
- Support for multiple browsers
- Parallel test execution

## License

MIT

