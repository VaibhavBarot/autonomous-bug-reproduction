import express from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { PlaywrightController } from './playwright-controller';
import { ClickAction, InputAction } from './types';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// Load env vars from root .env file
// Try multiple paths to locate .env
const envPaths = [
  path.resolve(__dirname, '../../../../.env'), // When running from dist/ or src/ inside package
  path.resolve(process.cwd(), '.env'),         // When running from root
  path.resolve(process.cwd(), '../../.env')    // When running from package root
];

let envLoaded = false;
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    continue;
  }
  if (result.parsed) {
    console.log(chalk.green(`[Server] Loaded .env from ${envPath}`));
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.warn(chalk.yellow('[Server] Warning: Could not find or load .env file.'));
}

const app = express();
app.use(cors());
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.static(path.join(__dirname, '../public'))); // Serve static frontend

// SSE Clients + in-memory log buffer for chat
let sseClients: any[] = [];
let collectedLogs: { type: 'log' | 'error' | 'status'; message: string }[] = [];

// Broadcast log to all connected clients
function broadcastLog(type: 'log' | 'error' | 'status', message: string) {
  const entry = { type, message };
  collectedLogs.push(entry);
  // Keep only the most recent 500 lines for chat context
  if (collectedLogs.length > 500) {
    collectedLogs = collectedLogs.slice(-500);
  }

  const payload = JSON.stringify(entry);
  sseClients.forEach(client => {
    client.write(`data: ${payload}\n\n`);
  });
}

// Override console.log and console.error to capture logs
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  originalLog.apply(console, args);
  // Filter out noisy Playwright logs if needed, or just send all
  broadcastLog('log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};

console.error = function(...args) {
  originalError.apply(console, args);
  broadcastLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};

// SSE Endpoint
app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Simple chat endpoint over collected logs
app.post('/chat', async (req, res) => {
  try {
    const question = (req.body && req.body.question) || '';
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Missing question in request body.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on runner.' });
    }

    const model = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-pro',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0,
    } as any);

    const contextText = collectedLogs
      .map(l => `[${l.type.toUpperCase()}] ${l.message}`)
      .join('\n')
      .slice(-15000); // Keep last ~15k chars to stay compact

    const prompt = `
You are BugBot, a QA assistant explaining an automated bug reproduction / verification run
to a non-technical stakeholder.

You are given the recent system logs and a user question.

LOGS (most recent last):
${contextText}

USER QUESTION:
${question}

INSTRUCTIONS:
- Answer in clear, simple language (no stack traces, no code unless explicitly asked).
- Summarize what happened, what BugBot tried, and the current bug status if relevant.
- If something is unclear from the logs, say so and explain what extra info would be needed.
`;

    const llmResult: any = await (model as any).invoke(prompt);
    const text =
      Array.isArray(llmResult.content) && llmResult.content.length > 0
        ? (llmResult.content[0] as any).text ?? JSON.stringify(llmResult.content[0])
        : (llmResult.text ?? JSON.stringify(llmResult));

    return res.json({ answer: String(text).trim() });
  } catch (error: any) {
    console.error('[Chat] Error handling chat request:', error);
    return res.status(500).json({ error: error.message || 'Chat error' });
  }
});

// Helper to verify GitHub webhook signature
function verifyGithubSignature(req: any) {
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!secret) {
    console.error('[GitHub Webhook] Error: GITHUB_WEBHOOK_SECRET is missing in environment variables.');
    return false;
  }

  if (!signature) {
    console.error('[GitHub Webhook] Error: No signature found in request headers.');
    return false;
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');
  
  const isValid = crypto.timingSafeEqual(Buffer.from(signature as string), Buffer.from(digest));
  
  if (!isValid) {
    console.error(`[GitHub Webhook] Signature mismatch.`);
    console.error(`  Expected: ${digest}`);
    console.error(`  Received: ${signature}`);
    console.error(`  Secret (first 3 chars): ${secret.substring(0, 3)}...`);
  }
  
  return isValid;
}

// Add request logging middleware for debugging
if (process.env.DEBUG_API || process.env.VERBOSE) {
  app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    console.error(chalk.cyan(`\n[${timestamp}] ${req.method} ${req.path}`));
    
    if (Object.keys(req.body || {}).length > 0) {
      console.error(chalk.gray(`   Body: ${JSON.stringify(req.body, null, 2)}`));
    }
    if (Object.keys(req.query || {}).length > 0) {
      console.error(chalk.gray(`   Query: ${JSON.stringify(req.query, null, 2)}`));
    }
    
    // Log response
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - start;
      const statusColor = res.statusCode >= 400 ? chalk.red : chalk.green;
      console.error(statusColor(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`));
      
      if (res.statusCode >= 400) {
        try {
          const errorData = typeof data === 'string' ? JSON.parse(data) : data;
          console.error(chalk.red(`   Error: ${JSON.stringify(errorData, null, 2)}`));
        } catch (e) {
          console.error(chalk.red(`   Error: ${data}`));
        }
      } else if (req.path === '/dom') {
        const domData = typeof data === 'string' ? JSON.parse(data) : data;
        console.error(chalk.gray(`   DOM elements returned: ${Array.isArray(domData) ? domData.length : 'N/A'}`));
      } else if (req.path === '/state') {
        const stateData = typeof data === 'string' ? JSON.parse(data) : data;
        console.error(chalk.gray(`   URL: ${stateData.url || 'N/A'}`));
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  });
}

const controller = new PlaywrightController();
let isInitialized = false;

// Backend log monitoring (independent of Playwright)
import CDP from 'chrome-remote-interface';
let backendLogs: string[] = [];
let cdpClient: any = null;

async function monitorBackendLogs() {
  try {
    cdpClient = await CDP({ port: 9229 });
    const { Runtime } = cdpClient;
    await Runtime.enable();
    Runtime.consoleAPICalled((payload: { type: string; args: Array<{ value: any }>; }) => {
      if (payload.type === 'error' || payload.type === 'warning' || payload.type === 'log') {
        const logMsg = payload.args.map((a: { value: any }) => a.value).join(' ');
        backendLogs.push(`[${payload.type}] ${logMsg}`);
      }
    });
    Runtime.exceptionThrown((payload: { exceptionDetails: { text: string } }) => {
      backendLogs.push(`[exception] ${payload.exceptionDetails.text}`);
    });
  } catch (err: any) {
    backendLogs.push(`[monitor error] ${err?.message || String(err)}`);
  }
}

monitorBackendLogs();
// Backend logs endpoint (does not require Playwright session)
app.get('/backend-logs', (req, res) => {
  res.json({ backendLogs: backendLogs.slice(-50) });
});

// Health check endpoint (doesn't require browser initialization)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', initialized: isInitialized });
});

// Initialize browser
app.post('/init', async (req, res) => {
  try {
    const { headless = false, stagehandApiKey, stagehandModelProvider } = req.body;
    console.log(`[Server] Initializing browser (headless: ${headless})...`);
    await controller.initialize(headless, stagehandApiKey, stagehandModelProvider);
    isInitialized = true;
    console.log(`[Server] Browser initialized successfully`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] Browser initialization failed:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Navigate to URL
app.post('/navigate', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { url } = req.body;
    await controller.navigate(url);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get simplified DOM
app.get('/dom', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const dom = await controller.getDOM();
    res.json(dom);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Click action
app.post('/action/click', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { selector }: ClickAction = req.body;
    console.log(`[Server] /action/click received selector: "${selector}"`);
    await controller.click(selector);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] /action/click error:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Input action
app.post('/action/input', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { selector, text }: InputAction = req.body;
    await controller.input(selector, text);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get network entries
app.get('/network', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const entries = await controller.getNetworkEntries();
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get screenshot
app.get('/screenshot', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const screenshot = await controller.getScreenshot();
    res.json({ screenshot, format: 'base64' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get browser state
app.get('/state', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const state = await controller.getState();
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop tracing and get video path
app.post('/stop', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { tracingPath } = req.body;
    await controller.stopTracing(tracingPath);
    const videoPath = await controller.getVideoPath();
    res.json({ success: true, videoPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stagehand act (natural language action)
app.post('/action/act', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { instruction }: { instruction: string } = req.body;
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }
    console.log(`[Server] /action/act received instruction: "${instruction}"`);
    try {
      const result = await controller.act(instruction);
      res.json({ success: true, result });
    } catch (stagehandError: any) {
      // If Stagehand fails, return error but don't crash
      // The agent can fall back to legacy tools
      console.error(`[Server] Stagehand act() failed, agent should use legacy tools:`, stagehandError.message);
      res.status(500).json({ 
        error: `Stagehand not available: ${stagehandError.message}. Please use legacy click/input tools instead.`,
        stagehandError: true
      });
    }
  } catch (error: any) {
    console.error(`[Server] /action/act error:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Stagehand extract (natural language extraction)
app.post('/extract', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { instruction, schema }: { instruction: string; schema?: any } = req.body;
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }
    console.log(`[Server] /extract received instruction: "${instruction}"`);
    try {
      const result = await controller.extract(instruction, schema);
      res.json({ success: true, data: result });
    } catch (stagehandError: any) {
      console.error(`[Server] Stagehand extract() failed, agent should use legacy tools:`, stagehandError.message);
      res.status(500).json({ 
        error: `Stagehand not available: ${stagehandError.message}. Please use legacy DOM parsing instead.`,
        stagehandError: true
      });
    }
  } catch (error: any) {
    console.error(`[Server] /extract error:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Stagehand observe (get available actions)
app.get('/observe', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    try {
      const observations = await controller.observe();
      res.json({ success: true, observations });
    } catch (stagehandError: any) {
      // If observe fails, return empty observations so agent can continue
      console.error(`[Server] Stagehand observe() failed, returning empty observations:`, stagehandError.message);
      res.json({ success: true, observations: [] });
    }
  } catch (error: any) {
    console.error(`[Server] /observe error:`, error);
    // Don't fail completely - return empty observations
    res.json({ success: true, observations: [] });
  }
});

// Close browser
app.post('/close', async (req, res) => {
  try {
    await controller.close();
    isInitialized = false;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GitHub Webhook Endpoint
app.post('/github-webhook', async (req: any, res) => {
  try {
    // 1. Verify signature
    if (!verifyGithubSignature(req)) {
      console.error('[GitHub Webhook] Signature verification failed');
      return res.status(401).send('Invalid signature');
    }

    const event = req.headers['x-github-event'];
    const payload = req.body;

    console.log(`[GitHub Webhook] Received event: ${event}`);

    // 2. Handle Pull Request events
    if (event === 'pull_request') {
      const action = payload.action;
      if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
        const repoUrl = payload.repository.clone_url; // e.g. https://github.com/user/repo.git
        const branch = payload.pull_request.head.ref; // PR branch
        const prTitle = payload.pull_request.title;
        const prBody = payload.pull_request.body || '';
        const prNumber = payload.pull_request.number;

        console.log(`[GitHub Webhook] Processing PR #${prNumber} (${action}) on branch "${branch}"`);

        // 3. Send immediate response to GitHub
        res.status(200).json({ message: 'Webhook received, starting processing' });

        // 4. Start processing in background
        (async () => {
          try {
            // Dynamically require modules to avoid circular deps and handle build paths
            // Try to find the api module
            let daytonaModule;
            let runBugBotModule;
            
            try {
              // Try src first (dev mode)
              daytonaModule = require('../../api/src/daytona-sandbox');
              runBugBotModule = require('../../api/src/run-bugbot');
            } catch (e) {
              // Fallback to dist (prod mode) - adjusting path based on likely structure
              try {
                daytonaModule = require('../../api/dist/daytona-sandbox');
                runBugBotModule = require('../../api/dist/run-bugbot');
              } catch (e2) {
                console.error('[GitHub Webhook] Failed to load API modules:', e2);
                return;
              }
            }

            const { startDaytonaSandbox } = daytonaModule;
            const { runBugBot } = runBugBotModule;

            // 5. Start Daytona Sandbox
            broadcastLog('status', 'Starting Daytona Sandbox...');
            console.log(`[GitHub Webhook] Starting Daytona sandbox for branch: ${branch}`);
            const sandbox = await startDaytonaSandbox({
              repoUrl,
              branch,
              projectPath: '.', // Assuming root for now, or 'test-app' if specifically for that repo?
              // If this is the test-app repo, the app is likely in root or specific folder.
              // The user prompt says "test-app repo", so let's assume standard structure.
              // If it's the monorepo, maybe 'test-app' folder?
              // Let's default to '.' but maybe check repo name
              port: 3000, // Assuming backend port or frontend? Usually frontend for testing?
              // But BugBot tests the frontend (4200) which talks to backend (3000).
              // If Daytona runs both, we need to know which one to expose or both.
              // startDaytonaSandbox exposes one port.
              // If we use the 'test-app' from this repo, it has frontend (4200) and backend (3000).
              // We probably want to expose the frontend (4200).
              installCommand: 'npm install', 
              startCommand: 'npm start', // This needs to start both? Or maybe the repo has a start script.
              // For the current test-app, it's `sh start.sh`?
            });

            console.log(`[GitHub Webhook] Sandbox running at: ${sandbox.appUrl}`);
            broadcastLog('status', `Sandbox Running: ${sandbox.appUrl}`);

            // 6. Run BugBot
            let bugDescription = `This is a Verification Run for PR #${prNumber}: ${prTitle}\n\n${prBody}\n\nGOAL: Attempt to reproduce the reported issue. If the issue occurs, the fix has failed.`;
            
            // Attempt to fetch bug details from Linear if a Linear ticket ID is found
            if (process.env.LINEAR_API_KEY) {
              const linearTicketRegex = /([A-Z]+-\d+)/i;
              const match = (prTitle + ' ' + branch).match(linearTicketRegex);
              if (match) {
                const ticketId = match[1].toUpperCase();
                console.log(`[GitHub Webhook] Detected Linear Ticket: ${ticketId}`);
                try {
                  const { LinearClient } = require('@linear/sdk');
                  const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
                  const issue = await linearClient.issue(ticketId);
                  if (issue) {
                    const description = await issue.description;
                    if (description) {
                      console.log(`[GitHub Webhook] Fetched Linear description for ${ticketId}`);
                      bugDescription += `\n\n--- LINEAR TICKET (${ticketId}) ---\n${description}\n---------------------------`;
                    }
                  }
                } catch (linearError: any) {
                  console.warn(`[GitHub Webhook] Failed to fetch Linear ticket ${ticketId}:`, linearError.message);
                }
              }
            }

            const config = {
              runnerUrl: 'http://localhost:3001', // This runner
              targetUrl: sandbox.appUrl, // The Daytona preview URL
              bugDescription,
              maxSteps: 20,
              timeout: 300 * 1000,
              apiKey: process.env.GEMINI_API_KEY,
              provider: 'gemini',
              headless: true, // Headless for automated runs
              verbose: true
            };

            console.log('[GitHub Webhook] Starting BugBot...');
            broadcastLog('status', 'Running BugBot Agent...');
            const reportData = await runBugBot(config);
            console.log('[GitHub Webhook] BugBot run completed');
            broadcastLog('status', 'BugBot Completed. Posting results...');

            // 7. Post results back to GitHub PR
            if (process.env.GITHUB_TOKEN) {
              try {
                const owner = payload.repository.owner.login;
                const repoName = payload.repository.name;
                
                const isReproduced = reportData.status === 'reproduced';
                const statusEmoji = isReproduced ? '⚠️' : '✅';
                const statusHeader = isReproduced ? 'Bug Still Present' : 'Bug Likely Solved';
                const statusMessage = isReproduced 
                  ? 'The agent was able to reproduce the bug in this PR environment. The fix may be incomplete.'
                  : 'The agent could NOT reproduce the bug in this PR environment. The fix appears to work (or the bug is not triggering).';
                
                const commentBody = `
## BugBot Verification Report ${statusEmoji}

**Result:** ${statusHeader}

${statusMessage}

### Analysis
${reportData.report?.rootCauseAnalysis || 'No root cause analysis available.'}

### Recommendation
${reportData.report?.recommendation || 'No recommendation available.'}

### Steps Taken
${reportData.steps.map((s: any) => `${s.stepNumber}. ${s.action.target || s.thought}`).join('\n')}

<details>
<summary>Raw Execution Log</summary>

\`\`\`json
${JSON.stringify(reportData.steps, null, 2)}
\`\`\`

</details>
`;

                console.log(`[GitHub Webhook] Posting comment to PR #${prNumber}...`);
                // Using axios directly to avoid adding octokit dependency if not needed
                // Need to import axios if not available, but runBugBot uses it, so it should be in node_modules
                // We can use dynamic import or require
                const axios = require('axios');
                await axios.post(
                  `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
                  { body: commentBody },
                  {
                    headers: {
                      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                      'Accept': 'application/vnd.github.v3+json',
                      'User-Agent': 'BugBot-Runner'
                    }
                  }
                );
                console.log(`[GitHub Webhook] Successfully posted comment to PR #${prNumber}`);
              } catch (commentError: any) {
                console.error('[GitHub Webhook] Failed to post comment:', commentError.message);
              }
            } else {
              console.warn('[GitHub Webhook] GITHUB_TOKEN not found, skipping PR comment.');
            }

            // Cleanup sandbox
            // await sandbox.stop(); // Optional: keep it running for debugging? Or clean up?
            // Usually CI cleans up. Let's clean up to save resources.
            await sandbox.stop();
            console.log('[GitHub Webhook] Sandbox cleaned up');

          } catch (err: any) {
            console.error('[GitHub Webhook] Background processing failed:', err);
          }
        })();
        
        return;
      }
    }

    // Default response for other events
    res.status(200).send('Event ignored');

  } catch (error: any) {
    console.error('[GitHub Webhook] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Linear webhook deduplication cache
// Store processed webhook events: key = issueId + updatedAt, value = timestamp
const processedLinearEvents = new Map<string, number>();
const DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedLinearEvents.entries()) {
    if (now - timestamp > DEDUP_TTL) {
      processedLinearEvents.delete(key);
    }
  }
}, 60000); // Clean every minute

// Linear webhook endpoint
app.post('/linear-webhook', async (req, res) => {
  try {
    const action = req.body.action; // e.g., "create", "update", "remove"
    const issueData = req.body.data;
    const webhookId = req.body.webhookId || req.body.id;
    
    // Send immediate response to Linear
    res.status(200).json({ received: true });

    // Only process "create" or "update" actions
    if (action !== 'create' && action !== 'update') {
      broadcastLog('log', `[Linear Webhook] Ignoring action: ${action}`);
      return;
    }

    if (!issueData) {
      broadcastLog('log', '[Linear Webhook] No issue data in payload');
      return;
    }

    const issueId = issueData.id || issueData.identifier;
    const updatedAt = issueData.updatedAt || Date.now();
    
    // Deduplication: check if we've already processed this event
    const dedupKey = `${issueId}-${updatedAt}`;
    if (processedLinearEvents.has(dedupKey)) {
      broadcastLog('log', `[Linear Webhook] Duplicate event ignored: ${issueId} (${action})`);
      return;
    }

    // Mark as processed
    processedLinearEvents.set(dedupKey, Date.now());

    const bugTitle = issueData.title || 'No title';
    const bugDescription = issueData.description || bugTitle;
    
    // For "update" actions, check if description actually changed
    // (Linear might send updates for other fields like assignee, status, etc.)
    if (action === 'update') {
      // If description is missing or unchanged, skip BugBot run
      // Note: Linear doesn't always send the full issue in update events
      // So we'll process it if description is present
      if (!issueData.description) {
        broadcastLog('log', `[Linear Webhook] Update event for ${issueId} has no description change, skipping`);
        return;
      }
    }

    broadcastLog('log', `[Linear Webhook] Processing ${action} event for: ${bugTitle}`);
    broadcastLog('log', `[Linear Webhook] Bug description: ${bugDescription}`);
    broadcastLog('status', `Processing Linear bug: ${bugTitle}`);

    // Run BugBot in background (non-blocking)
    (async () => {
      try {
        const { runBugBot } = require('../../api/src/run-bugbot');
        const config = {
          runnerUrl: 'http://localhost:3001',
          targetUrl: 'http://localhost:4200',
          bugDescription,
          maxSteps: 20,
          timeout: 300 * 1000,
          apiKey: process.env.GEMINI_API_KEY,
          provider: 'gemini',
          headless: false,
          verbose: false
        };
        await runBugBot(config);
        broadcastLog('status', `Linear bug run completed: ${bugTitle}`);
      } catch (err: any) {
        broadcastLog('error', `[Linear Webhook] BugBot run failed: ${err.message}`);
        broadcastLog('status', `Linear bug run failed: ${bugTitle}`);
      }
    })();

  } catch (error: any) {
    broadcastLog('error', `[Linear Webhook] Error: ${error.message}`);
    // Response already sent, so we can't send error response
  }
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Runner server listening on port ${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please free the port or use a different one.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

export { app };

