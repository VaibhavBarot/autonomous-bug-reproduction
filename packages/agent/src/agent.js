"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BugReproductionAgent = void 0;
const openai_1 = __importDefault(require("openai"));
const prompt_1 = require("./prompt");
class BugReproductionAgent {
    client;
    model;
    constructor(apiKey, model = 'gpt-4-turbo-preview') {
        this.client = new openai_1.default({
            apiKey: apiKey || process.env.OPENAI_API_KEY
        });
        this.model = model;
    }
    async decideNextAction(bugDescription, observation, history) {
        const prompt = (0, prompt_1.buildPrompt)(bugDescription, observation, history);
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
            // Parse JSON response
            let parsed;
            try {
                parsed = JSON.parse(content);
            }
            catch (parseError) {
                // Try to extract JSON from markdown code blocks if present
                const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[1]);
                }
                else {
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
            return parsed;
        }
        catch (error) {
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
    async checkIfReproduced(bugDescription, observation, history) {
        const response = await this.decideNextAction(bugDescription, observation, history);
        return response.status === 'reproduced';
    }
}
exports.BugReproductionAgent = BugReproductionAgent;
