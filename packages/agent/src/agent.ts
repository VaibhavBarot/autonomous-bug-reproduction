import OpenAI from 'openai';
import { AgentObservation, AgentAction, AgentHistory, AgentResponse, DatabaseContext } from './types';
import { buildPrompt } from './prompt';
import { MCPClient } from './mcp-client';
import chalk from 'chalk';

export type LLMProvider = 'openai' | 'gemini';

export class BugReproductionAgent {
  private client: OpenAI;
  private model: string;
  private provider: LLMProvider;
  private verbose: boolean;
  private mcpClient?: MCPClient;
  private databaseEnabled: boolean;
  private databaseContext: DatabaseContext = {};

  constructor(
    apiKey?: string, 
    provider: LLMProvider = 'gemini', 
    model?: string, 
    verbose: boolean = false,
    enableDatabase: boolean = false,
    mongoConnectionString?: string
  ) {
    this.provider = provider;
    this.verbose = verbose;
    this.databaseEnabled = enableDatabase && !!mongoConnectionString;

    // Initialize MCP client if database is enabled
    if (this.databaseEnabled && mongoConnectionString) {
      const readOnly = process.env.MCP_READ_ONLY === 'true';
      this.mcpClient = new MCPClient(mongoConnectionString, readOnly, verbose);
    }
    
    // Set default model based on provider
    if (!model) {
      this.model = provider === 'gemini' ? 'gemini-2.0-flash-thinking-exp-01-21' : 'gpt-4-turbo-preview';
    } else {
      this.model = model;
    }

    // Get API key from parameter, provider-specific env var, or fallback
    const key = apiKey || 
      (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) ||
      process.env.GEMINI_API_KEY || 
      process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error(`API key required. Set ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} environment variable or pass as parameter.`);
    }

    // Configure client based on provider
    if (provider === 'gemini') {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
      });
    } else {
      this.client = new OpenAI({
        apiKey: key
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.mcpClient && !this.mcpClient.isConnected()) {
      try {
        await this.mcpClient.connect();
        
        // Load available collections
        const collectionsResult = await this.mcpClient.listCollections();
        if (collectionsResult.success) {
          this.databaseContext.collections = collectionsResult.data;
        }

        if (this.verbose) {
          console.log(chalk.green('✓ MongoDB MCP client connected'));
          if (this.databaseContext.collections) {
            console.log(chalk.gray(`  Available collections: ${this.databaseContext.collections.join(', ')}`));
          }
        }
      } catch (error: any) {
        console.error(chalk.yellow(`⚠ Failed to connect to MongoDB MCP: ${error.message}`));
        console.error(chalk.yellow('  Agent will continue without database query capabilities'));
        this.databaseEnabled = false;
      }
    }
  }

  async decideNextAction(
    bugDescription: string,
    observation: AgentObservation,
    history: AgentHistory
  ): Promise<AgentResponse> {
    const prompt = buildPrompt(bugDescription, observation, history, this.databaseEnabled, this.databaseContext);

    if (this.verbose) {
      console.log(chalk.gray('\n' + '='.repeat(80)));
      console.log(chalk.cyan.bold('🧠 LLM REQUEST'));
      console.log(chalk.gray('='.repeat(80)));
      console.log(chalk.yellow(`Model: ${this.model} (${this.provider})`));
      console.log(chalk.yellow(`Step: ${observation.stepNumber}`));
      console.log(chalk.yellow(`URL: ${observation.state.url}`));
      console.log(chalk.yellow(`Clickable Elements: ${observation.dom.filter(e => e.clickable).length}`));
      console.log(chalk.yellow(`Previous Actions: ${history.actions.length}`));
      console.log(chalk.gray('\n--- PROMPT SENT TO LLM ---'));
      console.log(chalk.white(prompt.substring(0, 1000) + (prompt.length > 1000 ? '...' : '')));
      if (prompt.length > 1000) {
        console.log(chalk.gray(`(Prompt truncated, full length: ${prompt.length} chars)`));
      }
      console.log(chalk.gray('='.repeat(80)));
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a UI testing agent. Always respond with valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from LLM');
      }

      if (this.verbose) {
        console.log(chalk.gray('\n--- RAW LLM RESPONSE ---'));
        console.log(chalk.white(content));
        console.log(chalk.gray('='.repeat(80)));
      }

      // Parse JSON response
      let parsed: AgentResponse;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          throw parseError;
        }
      }

      // Validate response structure
      if (!parsed.action || !parsed.action.type) {
        throw new Error('Invalid response: missing action');
      }

      // Set default status if not provided
      if (!parsed.status) {
        parsed.status = 'in_progress';
      }

      if (this.verbose) {
        console.log(chalk.green.bold('\n✅ LLM DECISION'));
        console.log(chalk.gray('='.repeat(80)));
        console.log(chalk.cyan(`Thought: ${parsed.thought}`));
        console.log(chalk.blue(`Action Type: ${parsed.action.type}`));
        console.log(chalk.blue(`Selector: ${parsed.action.selector}`));
        if (parsed.action.text) {
          console.log(chalk.blue(`Text: ${parsed.action.text}`));
        }
        if (parsed.status) {
          console.log(chalk.magenta(`Status: ${parsed.status}`));
        }
        if (parsed.reason) {
          console.log(chalk.yellow(`Reason: ${parsed.reason}`));
        }
        console.log(chalk.gray('='.repeat(80) + '\n'));
      }

      return parsed;
    } catch (error: any) {
      // Fallback response on error
      return {
        thought: `Error occurred: ${error.message}. Will try a simple click action.`,
        action: {
          type: 'click',
          selector: observation.dom.find(el => el.clickable)?.selector || 'body',
          target: 'First clickable element'
        },
        status: 'in_progress'
      };
    }
  }

  async checkIfReproduced(
    bugDescription: string,
    observation: AgentObservation,
    history: AgentHistory
  ): Promise<boolean> {
    const response = await this.decideNextAction(bugDescription, observation, history);
    return response.status === 'reproduced';
  }

  async executeAction(action: AgentAction): Promise<any> {
    if (action.type === 'query_database' && this.mcpClient && action.dbQuery) {
      if (this.verbose) {
        console.log(chalk.cyan(`\n📊 Executing database query...`));
        console.log(chalk.gray(`  Collection: ${action.dbQuery.collection}`));
        console.log(chalk.gray(`  Operation: ${action.dbQuery.operation}`));
      }

      try {
        let result;
        switch (action.dbQuery.operation) {
          case 'find':
            result = await this.mcpClient.query(
              action.dbQuery.collection,
              action.dbQuery.query,
              action.dbQuery.options
            );
            break;
          case 'findOne':
            result = await this.mcpClient.findOne(
              action.dbQuery.collection,
              action.dbQuery.query
            );
            break;
          case 'aggregate':
            result = await this.mcpClient.aggregate(
              action.dbQuery.collection,
              action.dbQuery.pipeline || []
            );
            break;
          case 'getSchema':
            result = await this.mcpClient.getSchema(action.dbQuery.collection);
            break;
          case 'listCollections':
            result = await this.mcpClient.listCollections();
            break;
          default:
            throw new Error(`Unknown database operation: ${action.dbQuery.operation}`);
        }

        if (this.verbose) {
          console.log(chalk.green(`✓ Database query completed`));
          if (result.success) {
            console.log(chalk.gray(`  Result: ${JSON.stringify(result.data).substring(0, 200)}...`));
          } else {
            console.log(chalk.red(`  Error: ${result.error}`));
          }
        }

        // Store result in context for next iteration
        this.databaseContext.lastQueryResult = result.data;
        
        return result;
      } catch (error: any) {
        if (this.verbose) {
          console.error(chalk.red(`❌ Database query failed: ${error.message}`));
        }
        return {
          success: false,
          error: error.message
        };
      }
    }
    
    throw new Error('Database query action requires MCP client and dbQuery parameters');
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
      if (this.verbose) {
        console.log(chalk.gray('MongoDB MCP client disconnected'));
      }
    }
  }

  isDatabaseEnabled(): boolean {
    return this.databaseEnabled && !!this.mcpClient?.isConnected();
  }

  getDatabaseContext(): DatabaseContext {
    return this.databaseContext;
  }
}

