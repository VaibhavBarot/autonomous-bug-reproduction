import express from 'express';
import crypto from 'crypto';
import { PRHandler } from './pr-handler';
import { GitHubClient } from './github-client';
import dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from the project root
const rootPath = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(rootPath, '.env') });

const app = express();

// Log all requests for debugging (before parsing)
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  }
  next();
});

// Support both JSON and URL-encoded payloads (GitHub can send either)
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Verify GitHub webhook signature
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  console.log('📥 Webhook request received');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Body keys:', Object.keys(req.body || {}));
  
  try {
    // Handle form-encoded payload (GitHub sends payload as a JSON string in req.body.payload)
    let payload = req.body;
    if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      if (req.body.payload && typeof req.body.payload === 'string') {
        try {
          payload = JSON.parse(req.body.payload);
          console.log('✅ Parsed form-encoded payload');
          console.log('Parsed payload keys:', Object.keys(payload || {}));
        } catch (e) {
          console.error('❌ Failed to parse payload JSON:', e);
          console.error('Payload string (first 200 chars):', req.body.payload.substring(0, 200));
          return res.status(400).json({ error: 'Invalid payload format' });
        }
      } else if (req.body.payload) {
        // Already parsed somehow
        payload = req.body.payload;
        console.log('✅ Using already parsed payload');
      } else {
        console.log('⚠️ No payload field found in form-encoded body');
      }
    }
    
    // Verify webhook signature (if secret is set)
    // Note: For proper signature verification, we'd need the raw body
    // For now, we'll skip if body is already parsed (form-encoded case)
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret.trim() !== '' && req.headers['content-type']?.includes('application/json')) {
      const signature = req.headers['x-hub-signature-256'] as string;
      const payloadString = JSON.stringify(payload);
      if (!signature || !verifySignature(payloadString, signature, webhookSecret)) {
        console.error('❌ Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else if (webhookSecret && webhookSecret.trim() !== '') {
      console.log('ℹ️  Skipping signature verification (not JSON content-type)');
    } else {
      console.log('ℹ️  Skipping signature verification (no secret configured)');
    }

    const event = req.headers['x-github-event'] as string;
    
    console.log(`📋 Event type: ${event}`);
    console.log(`📋 Action: ${payload?.action || 'N/A'}`);

    // Only handle pull_request events
    if (event !== 'pull_request') {
      console.log(`⏭️  Ignoring event type: ${event}`);
      return res.status(200).json({ message: 'Event ignored' });
    }

    // Only handle opened and synchronize (new commits) events
    if (!['opened', 'synchronize'].includes(payload.action)) {
      console.log(`⏭️  Ignoring action: ${payload.action}`);
      return res.status(200).json({ message: 'Action ignored' });
    }

    const pr = payload.pull_request;
    const repo = payload.repository;

    // Extract PR context
    const prContext = {
      owner: repo.owner.login,
      repo: repo.name,
      prNumber: pr.number,
      branch: pr.head.ref,
      repoUrl: pr.head.repo.clone_url,
    };

    console.log(`Received PR event: ${payload.action} for PR #${pr.number}`);

    // Process PR asynchronously (don't block response)
    processPR(prContext).catch(err => {
      console.error('Error processing PR:', err);
    });

    // Respond immediately
    res.status(200).json({ message: 'Webhook received, processing...' });

  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helpful message for GET requests to webhook
app.get('/webhook', (req, res) => {
  res.json({ 
    message: 'Webhook endpoint is active! This endpoint only accepts POST requests from GitHub.',
    status: 'ok',
    endpoint: '/webhook',
    method: 'POST'
  });
});

// Process PR (async function)
async function processPR(prContext: any) {
  // Validate required environment variables
  const required = [
    'DAYTONA_API_URL',
    'DAYTONA_API_KEY',
    'GITHUB_TOKEN',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  // Get PR details
  const github = new GitHubClient(process.env.GITHUB_TOKEN!);
  const prDetails = await github.getPRDetails(
    prContext.owner,
    prContext.repo,
    prContext.prNumber
  );

  // Create PR handler
  const handler = new PRHandler({
    daytonaApiUrl: process.env.DAYTONA_API_URL!,
    daytonaApiKey: process.env.DAYTONA_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    bugbotRepoUrl: process.env.BUGBOT_REPO_URL || 'https://github.com/VaibhavBarot/autonomous-bug-reproduction.git',
    bugDescription: process.env.BUG_DESCRIPTION || undefined,
    maxSteps: parseInt(process.env.MAX_STEPS || '20'),
    timeout: parseInt(process.env.TIMEOUT || '300'),
    apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
    provider: (process.env.LLM_PROVIDER as 'gemini' | 'openai') || 'gemini',
    headless: process.env.HEADLESS !== 'false',
  });

  // Handle PR
  await handler.handlePR(prContext);
}

const PORT = process.env.PORT || 3002;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 BugBot Webhook Server listening on port ${PORT}`);
    console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
  });
}

export { app };

