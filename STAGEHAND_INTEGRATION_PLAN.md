# Stagehand Integration Plan

This document outlines all the changes required to integrate Stagehand into the BugBot system to make browser actions smarter and more context-aware.

## Overview

Stagehand will replace the current manual selector-based actions with natural language-driven actions. Instead of the agent deciding on selectors, Stagehand will use LLM reasoning to understand the page context and perform actions based on natural language instructions.

## Key Changes Summary

1. **Install Stagehand package** in `packages/runner`
2. **Create StagehandController** to wrap Stagehand functionality
3. **Add new API endpoints** for Stagehand's `act()` and `extract()` methods
4. **Update PlaywrightController** to integrate Stagehand
5. **Create new LangChain tools** for Stagehand actions
6. **Update ExecutorAgent** to use Stagehand in a loop-based workflow
7. **Add configuration** for Stagehand model provider

---

## Detailed Changes

### 1. Package Dependencies

#### File: `packages/runner/package.json`
**Change**: Add Stagehand dependency

```json
{
  "dependencies": {
    "@browserbasehq/stagehand": "^latest",
    // ... existing dependencies
  }
}
```

**Action**: Run `npm install @browserbasehq/stagehand` in `packages/runner`

---

### 2. New Types

#### File: `packages/runner/src/types.ts`
**Change**: Add new interfaces for Stagehand actions

```typescript
export interface StagehandActAction {
  instruction: string;  // Natural language instruction like "click the Add to Cart button"
  screenshot?: string;  // Optional screenshot for context
}

export interface StagehandExtractAction {
  instruction: string;  // Natural language extraction like "get the price of the first product"
  schema?: any;  // Optional schema for structured extraction
}

export interface StagehandObserveAction {
  // No parameters needed - returns available actions
}
```

---

### 3. New StagehandController Class

#### File: `packages/runner/src/stagehand-controller.ts` (NEW FILE)
**Purpose**: Wraps Stagehand functionality and provides methods for act(), extract(), and observe()

```typescript
import { Page } from 'playwright';
import { Stagehand } from '@browserbasehq/stagehand';

export class StagehandController {
  private stagehand: Stagehand | null = null;
  private page: Page | null = null;

  async initialize(page: Page, apiKey?: string): Promise<void> {
    this.page = page;
    // Initialize Stagehand with the Playwright page
    // Configure with API key if provided
    this.stagehand = new Stagehand(page, {
      apiKey: apiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY,
      // Other config options
    });
  }

  async act(instruction: string): Promise<string> {
    if (!this.stagehand || !this.page) {
      throw new Error('Stagehand not initialized');
    }
    
    // Use Stagehand's act() method with natural language instruction
    const result = await this.stagehand.act(instruction);
    return result;
  }

  async extract(instruction: string, schema?: any): Promise<any> {
    if (!this.stagehand || !this.page) {
      throw new Error('Stagehand not initialized');
    }
    
    // Use Stagehand's extract() method
    const result = await this.stagehand.extract(instruction, schema);
    return result;
  }

  async observe(): Promise<any> {
    if (!this.stagehand || !this.page) {
      throw new Error('Stagehand not initialized');
    }
    
    // Get available actions and elements on the page
    const observations = await this.stagehand.observe();
    return observations;
  }

  isInitialized(): boolean {
    return this.stagehand !== null;
  }
}
```

---

### 4. Update PlaywrightController

#### File: `packages/runner/src/playwright-controller.ts`
**Changes**:
1. Add StagehandController instance
2. Initialize Stagehand when browser is initialized
3. Add methods to delegate to Stagehand

```typescript
import { StagehandController } from './stagehand-controller';

export class PlaywrightController {
  // ... existing properties
  private stagehandController: StagehandController;
  private stagehandApiKey?: string;

  async initialize(headless: boolean = false, stagehandApiKey?: string): Promise<void> {
    // ... existing initialization code
    
    this.stagehandController = new StagehandController();
    this.stagehandApiKey = stagehandApiKey;
    
    // Initialize Stagehand after page is created
    if (this.page) {
      await this.stagehandController.initialize(this.page, stagehandApiKey);
    }
  }

  // New method: Smart action using Stagehand
  async act(instruction: string): Promise<string> {
    if (!this.stagehandController.isInitialized()) {
      throw new Error('Stagehand not initialized');
    }
    return await this.stagehandController.act(instruction);
  }

  // New method: Extract data using Stagehand
  async extract(instruction: string, schema?: any): Promise<any> {
    if (!this.stagehandController.isInitialized()) {
      throw new Error('Stagehand not initialized');
    }
    return await this.stagehandController.extract(instruction, schema);
  }

  // New method: Observe page state using Stagehand
  async observe(): Promise<any> {
    if (!this.stagehandController.isInitialized()) {
      throw new Error('Stagehand not initialized');
    }
    return await this.stagehandController.observe();
  }

  // ... rest of existing methods
}
```

---

### 5. Update Runner Server API

#### File: `packages/runner/src/server.ts`
**Changes**: Add new endpoints for Stagehand actions

```typescript
// Add new endpoint: Stagehand act (natural language action)
app.post('/action/act', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { instruction }: { instruction: string } = req.body;
    console.error(`[Server] /action/act received instruction: "${instruction}"`);
    const result = await controller.act(instruction);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error(`[Server] /action/act error:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Add new endpoint: Stagehand extract (natural language extraction)
app.post('/extract', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { instruction, schema }: { instruction: string; schema?: any } = req.body;
    const result = await controller.extract(instruction, schema);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add new endpoint: Stagehand observe (get available actions)
app.get('/observe', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const observations = await controller.observe();
    res.json({ success: true, observations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update /init endpoint to accept stagehandApiKey
app.post('/init', async (req, res) => {
  try {
    const { headless = false, stagehandApiKey } = req.body;
    console.error(`[Server] Initializing browser (headless: ${headless})...`);
    await controller.initialize(headless, stagehandApiKey);
    isInitialized = true;
    console.error(`[Server] Browser initialized successfully`);
    res.json({ success: true });
  } catch (error: any) {
    // ... existing error handling
  }
});
```

---

### 6. New LangChain Tools for Stagehand

#### File: `packages/agent/src/tools/stagehand-tools.ts` (NEW FILE)
**Purpose**: Create LangChain tools that wrap Stagehand API endpoints

```typescript
import { StructuredTool } from "@langchain/core/tools";
import axios from "axios";
import { z } from "zod";

export abstract class StagehandBaseTool extends StructuredTool {
  protected runnerUrl: string;

  constructor(runnerUrl: string) {
    super();
    this.runnerUrl = runnerUrl;
  }
}

export class StagehandActTool extends StagehandBaseTool {
  name = "stagehand_act";
  description = "Perform a browser action using natural language. Use this instead of manual click/input when you want Stagehand to intelligently find and interact with elements. Example: 'click the Add to Cart button for Product 2' or 'type my email in the login form'";
  schema = z.object({
    instruction: z.string().describe("Natural language instruction for the action to perform"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { instruction: string }): Promise<string> {
    try {
      const response = await axios.post(`${this.runnerUrl}/action/act`, {
        instruction: input.instruction
      });
      return `Action completed: ${response.data.result || 'success'}`;
    } catch (error: any) {
      return `Failed to perform action: ${error.message}`;
    }
  }
}

export class StagehandExtractTool extends StagehandBaseTool {
  name = "stagehand_extract";
  description = "Extract data from the page using natural language. Example: 'get the price of the first product' or 'extract all product names and prices'";
  schema = z.object({
    instruction: z.string().describe("Natural language instruction for what data to extract"),
    schema: z.any().optional().describe("Optional schema for structured extraction"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { instruction: string; schema?: any }): Promise<string> {
    try {
      const response = await axios.post(`${this.runnerUrl}/extract`, {
        instruction: input.instruction,
        schema: input.schema
      });
      return JSON.stringify(response.data.data, null, 2);
    } catch (error: any) {
      return `Failed to extract data: ${error.message}`;
    }
  }
}

export class StagehandObserveTool extends StagehandBaseTool {
  name = "stagehand_observe";
  description = "Get a list of available actions and elements on the current page. Use this to understand what's possible before deciding on an action.";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/observe`);
      return JSON.stringify(response.data.observations, null, 2);
    } catch (error: any) {
      return `Failed to observe page: ${error.message}`;
    }
  }
}
```

---

### 7. Update ExecutorAgent

#### File: `packages/agent/src/executor-agent.ts`
**Changes**: 
1. Import new Stagehand tools
2. Add Stagehand tools to the tool list
3. Update the prompt to encourage using Stagehand for smarter actions
4. Create a loop-based workflow using observe → decide → act

```typescript
import { 
  StagehandActTool,
  StagehandExtractTool,
  StagehandObserveTool
} from "./tools/stagehand-tools";

export class ExecutorAgent {
  // ... existing code

  async executePlan(plan: TestPlan): Promise<ExecutionStepResult[]> {
    const results: ExecutionStepResult[] = [];

    for (const step of plan.steps) {
      console.log(`\nExecuting Step ${step.stepNumber}: ${step.description}`);

      try {
        // Create all tools (including Stagehand tools)
        const domTool = new GetDOMTool(this.runnerUrl);
        const stateTool = new GetStateTool(this.runnerUrl);
        const screenshotTool = new GetScreenshotTool(this.runnerUrl);
        const networkTool = new GetNetworkTool(this.runnerUrl);
        const backendLogsTool = new GetBackendLogsTool(this.runnerUrl);
        const navigateTool = new NavigateTool(this.runnerUrl);
        
        // Stagehand tools for smarter actions
        const stagehandActTool = new StagehandActTool(this.runnerUrl);
        const stagehandExtractTool = new StagehandExtractTool(this.runnerUrl);
        const stagehandObserveTool = new StagehandObserveTool(this.runnerUrl);
        
        // Legacy tools (keep for backward compatibility)
        const clickTool = new ClickTool(this.runnerUrl);
        const inputTool = new InputTool(this.runnerUrl);

        // Fetch current state
        const currentDOMStr = await domTool._call({});
        const currentStateStr = await stateTool._call({});
        const currentNetworkStr = await networkTool._call({});

        // NEW: Use Stagehand observe to get available actions
        const observationsStr = await stagehandObserveTool._call({});

        // ... existing parsing code ...

        const toolPrompt = `
You are an autonomous QA execution agent using tools to interact with a web page.

Bug description:
${step.description}

Current planned step:
${step.description}

Expected outcome:
${step.expectedOutcome}

Current simplified DOM (FULL JSON array of elements):
${currentDOMStr}

Current state:
${currentStateStr}

Recent network activity:
${currentNetworkStr}

Available actions on the page (from Stagehand observe):
${observationsStr}

Choose ONE best tool to move this step forward. PREFER using Stagehand tools for smarter, context-aware actions:

**Stagehand Tools (PREFERRED for complex actions):**
- "stagehand_act" with args { "instruction": "<natural language action>" }
  Example: "click the Add to Cart button for Product 2"
  Example: "fill in the email field with test@example.com"
  Use this when you need Stagehand to intelligently find and interact with elements.

- "stagehand_extract" with args { "instruction": "<what to extract>" }
  Example: "get the current cart count"
  Example: "extract all product names and prices"
  Use this to get specific data from the page.

- "stagehand_observe" with args {} to refresh the list of available actions

**Legacy Tools (use only if Stagehand is not suitable):**
- "navigate" with args { "url": "<url>" }
- "click" with args { "selector": "<locator>" } - only if you have a specific selector
- "input" with args { "selector": "<input selector>", "text": "<text>" } - only if you have a specific selector
- "get_backend_logs" with args {} to inspect recent backend logs
- "noop" if no action is needed (verification only).

Return ONLY valid JSON in this exact format (no extra commentary before or after, no markdown):
{
  "thought": "reason about what to do",
  "tool": "stagehand_act" | "stagehand_extract" | "stagehand_observe" | "navigate" | "click" | "input" | "get_backend_logs" | "noop",
  "args": { ... appropriate args ... }
}`;

        // ... rest of existing execution logic ...
        
        // Update tool execution to handle Stagehand tools
        if (toolName === "stagehand_act") {
          toolObservation = await stagehandActTool._call({ instruction: args.instruction });
        } else if (toolName === "stagehand_extract") {
          toolObservation = await stagehandExtractTool._call({ 
            instruction: args.instruction,
            schema: args.schema
          });
        } else if (toolName === "stagehand_observe") {
          toolObservation = await stagehandObserveTool._call({});
        } else if (toolName === "navigate") {
          // ... existing code
        }
        // ... rest of existing tool execution

      } catch (error: any) {
        // ... existing error handling
      }
    }

    return results;
  }
}
```

---

### 8. Update Orchestrator

#### File: `packages/api/src/orchestrator.ts`
**Changes**: Pass Stagehand API key when initializing browser

```typescript
async initialize(): Promise<void> {
  await this.artifactManager.initialize();
  
  // Initialize browser with Stagehand API key if available
  try {
    const response = await axios.post(`${this.config.runnerUrl}/init`, {
      headless: this.config.headless ?? false,
      stagehandApiKey: this.config.apiKey  // Pass API key for Stagehand
    });
    
    if (!response.data.success) {
      throw new Error('Browser initialization failed');
    }
  } catch (error: any) {
    // ... existing error handling
  }

  // ... rest of initialization
}
```

---

### 9. Update CLI Configuration

#### File: `packages/api/src/cli.ts`
**Changes**: Add option to enable/disable Stagehand and pass API key

```typescript
// Add to command options
.option('--use-stagehand', 'Use Stagehand for smarter browser actions (default: true)')
.option('--stagehand-api-key <key>', 'API key for Stagehand (uses same as LLM provider if not specified)')

// In the action handler, pass stagehandApiKey to orchestrator config
const orchestrator = new Orchestrator({
  runnerUrl,
  targetUrl: options.url,
  bugDescription,
  maxSteps: parseInt(options.maxSteps),
  timeout: parseInt(options.timeout) * 1000,
  apiKey: options.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
  provider: options.provider || 'gemini',
  headless: options.headless,
  verbose: options.verbose,
  useStagehand: options.useStagehand !== false, // Default to true
  stagehandApiKey: options.stagehandApiKey || options.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY
}, runId);
```

---

### 10. Update OrchestratorConfig Interface

#### File: `packages/api/src/orchestrator.ts`
**Changes**: Add Stagehand configuration options

```typescript
export interface OrchestratorConfig {
  runnerUrl: string;
  targetUrl: string;
  bugDescription: string;
  maxSteps: number;
  timeout: number;
  apiKey?: string;
  provider?: LLMProvider;
  headless?: boolean;
  verbose?: boolean;
  useStagehand?: boolean;  // NEW
  stagehandApiKey?: string;  // NEW
}
```

---

### 11. Update README

#### File: `README.md`
**Changes**: Document Stagehand integration

Add a new section:

```markdown
## Stagehand Integration

BugBot now uses [Stagehand](https://www.stagehand.dev/) for smarter, context-aware browser actions. Instead of relying on manual selectors, Stagehand uses natural language instructions to intelligently find and interact with page elements.

### Benefits

- **Smarter Actions**: Stagehand understands page context and can find elements even when the page structure changes
- **Natural Language**: Use instructions like "click the Add to Cart button for Product 2" instead of complex selectors
- **Self-Healing**: Automatically adapts to page changes
- **Better Extraction**: Extract data using natural language queries

### Usage

Stagehand is enabled by default. The same API key used for the LLM provider is also used for Stagehand.

```bash
# Stagehand will automatically be used for smarter actions
npm run bugbot -- "When I add item to cart, cart count does not increase"
```

### Configuration

You can disable Stagehand or use a different API key:

```bash
# Disable Stagehand (use legacy selector-based actions)
npm run bugbot -- "Bug description" --no-use-stagehand

# Use a specific API key for Stagehand
npm run bugbot -- "Bug description" --stagehand-api-key YOUR_KEY
```
```

---

## Implementation Order

1. **Phase 1: Core Integration**
   - Install Stagehand package
   - Create StagehandController
   - Update PlaywrightController to use Stagehand
   - Add new API endpoints

2. **Phase 2: Agent Integration**
   - Create Stagehand LangChain tools
   - Update ExecutorAgent to use Stagehand tools
   - Update prompts to prefer Stagehand

3. **Phase 3: Configuration & Documentation**
   - Update Orchestrator to pass API keys
   - Update CLI with Stagehand options
   - Update README with documentation

4. **Phase 4: Testing**
   - Test Stagehand act() with various instructions
   - Test Stagehand extract() for data extraction
   - Test observe() for page understanding
   - Verify backward compatibility with legacy tools

---

## Backward Compatibility

- Legacy `click` and `input` tools remain available
- Stagehand can be disabled via CLI flag
- Existing workflows continue to work
- Gradual migration path: agent can choose between Stagehand and legacy tools

---

## Testing Checklist

- [ ] Stagehand initialization works with Playwright
- [ ] `/action/act` endpoint works with natural language instructions
- [ ] `/extract` endpoint extracts data correctly
- [ ] `/observe` endpoint returns available actions
- [ ] ExecutorAgent can use Stagehand tools
- [ ] Legacy tools still work when Stagehand is disabled
- [ ] API key is properly passed through the system
- [ ] Error handling works for Stagehand failures
- [ ] Documentation is updated

---

## Notes

- Stagehand requires an API key (OpenAI or compatible)
- Stagehand works on top of Playwright, so existing Playwright features remain available
- The observe → decide → act loop pattern can be implemented in the ExecutorAgent for even smarter behavior
- Consider adding retry logic for Stagehand actions that fail

