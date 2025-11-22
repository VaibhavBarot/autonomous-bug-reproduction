# BugBot - Autonomous Bug Reproduction System

An autonomous system that uses LLM reasoning and Playwright automation to reproduce UI bugs described in natural language.

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

1. **Bug Ticket Input**: You provide a bug description in natural language
2. **LLM Planning**: The agent interprets the bug and generates an objective
3. **Browser Control**: Playwright opens a browser and navigates to the target URL
4. **Interactive Loop**:
   - Agent requests DOM elements and visible actions from Playwright
   - LLM decides next action based on objective and observations
   - Playwright executes actions and returns updated observations
   - Repeat until goal satisfied or timeout
5. **Report Generation**: System produces a comprehensive report with:
   - Steps taken
   - Observations at each step
   - Network logs (HAR format)
   - Console errors
   - Video recording
   - Reproduction result conclusion

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
│   ├── agent/           # LLM reasoning agent
│   │   ├── src/
│   │   │   ├── agent.ts               # Main reasoning loop
│   │   │   ├── prompt.ts              # Prompt templates
│   │   │   └── types.ts               # TypeScript types
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

- `POST /init` - Initialize browser (body: `{ headless: boolean }`)
- `POST /navigate` - Navigate to URL (body: `{ url: string }`)
- `GET /dom` - Get simplified DOM elements
- `POST /action/click` - Click element (body: `{ selector: string }`)
- `POST /action/input` - Type text (body: `{ selector: string, text: string }`)
- `GET /network` - Get network entries
- `GET /screenshot` - Get base64 screenshot
- `GET /state` - Get browser state summary
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

# 2. Run BugBot to find the bug
cd ..
npm run bugbot "When I add item to cart, cart count does not increase" \
  --url http://localhost:4200 \
  --api-key YOUR_GEMINI_KEY

# 3. Check the report
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

- Simple DOM extraction (no deep visual reasoning)
- Basic action set (click, input, navigate, wait)
- No support for complex interactions (drag & drop, file uploads, etc.)
- Limited error recovery
- No Daytona integration (designed for local development)

Future improvements could include:
- Visual element detection using screenshots
- More action types (scroll, hover, etc.)
- Better error handling and retry logic
- Daytona ephemeral environment integration
- Support for multiple browsers
- Parallel test execution

## License

MIT





#test-webhook