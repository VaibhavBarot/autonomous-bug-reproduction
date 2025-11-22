import OpenAI from 'openai';
import { AgentObservation, AgentAction, AgentHistory, AgentResponse } from './types';
import { buildPrompt } from './prompt';
import chalk from 'chalk';

export type LLMProvider = 'openai' | 'gemini';

export class BugReproductionAgent {
  private client: OpenAI;
  private model: string;
  private provider: LLMProvider;
  private verbose: boolean;

  constructor(apiKey?: string, provider: LLMProvider = 'gemini', model?: string, verbose: boolean = false) {
    this.provider = provider;
    this.verbose = verbose;
    
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

  async decideNextAction(
    bugDescription: string,
    observation: AgentObservation,
    history: AgentHistory
  ): Promise<AgentResponse> {
    const prompt = buildPrompt(bugDescription, observation, history);

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
}

