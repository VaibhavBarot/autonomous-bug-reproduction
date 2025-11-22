# Quick Start Guide

## Setup (One-time)

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Set your Gemini API key (or use OPENAI_API_KEY for OpenAI)
export GEMINI_API_KEY=your-gemini-key-here
```

## Running BugBot

### Basic Usage

```bash
# Run with default settings (tests http://localhost:3000)
npm run bugbot "When I add item to cart, cart count does not increase"
```

### With Options

```bash
# Test a different URL
npm run bugbot "Button doesn't work" --url http://localhost:8080

# Run headless
npm run bugbot "Bug description" --headless

# More steps
npm run bugbot "Complex bug" --max-steps 50
```

## Example Workflow

1. **Start your application** (in a separate terminal):
   ```bash
   cd your-app
   npm start  # Make sure it runs on http://localhost:3000
   ```

2. **Run BugBot**:
   ```bash
   npm run bugbot "When I click login, nothing happens"
   ```

3. **View the report**:
   ```bash
   open runs/run-*/report.html
   ```

## What Gets Captured

- ✅ Step-by-step actions taken
- ✅ DOM snapshots at each step
- ✅ Network traffic (HAR format)
- ✅ Console errors
- ✅ Video recording
- ✅ Playwright trace file

## Troubleshooting

**Runner server won't start:**
- Make sure port 3001 is available
- Check that Playwright browsers are installed: `npx playwright install`

**API errors:**
- Verify your API key is set: `echo $GEMINI_API_KEY` (or `echo $OPENAI_API_KEY`)
- Check your API key has credits/quota
- For Gemini, get your key from: https://aistudio.google.com/app/apikey

**Browser won't open:**
- Try running with `--headless` flag
- Check Playwright installation: `npx playwright --version`

