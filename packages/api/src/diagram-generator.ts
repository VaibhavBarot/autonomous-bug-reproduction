import OpenAI from 'openai';
import chalk from 'chalk';

export class DiagramGenerator {
    private client: OpenAI;
    private model: string;

    constructor(apiKey?: string, provider: 'openai' | 'gemini' = 'gemini') {
        const key = apiKey ||
            (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) ||
            process.env.GEMINI_API_KEY ||
            process.env.OPENAI_API_KEY;

        if (!key) {
            console.warn(chalk.yellow('Warning: No API key found for DiagramGenerator. Diagram will not be generated.'));
        }

        if (provider === 'gemini') {
            this.client = new OpenAI({
                apiKey: key || 'dummy', // Prevent crash if key is missing, check later
                baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
            });
            this.model = 'gemini-2.0-flash-thinking-exp-01-21';
        } else {
            this.client = new OpenAI({
                apiKey: key || 'dummy'
            });
            this.model = 'gpt-4-turbo-preview';
        }
    }

    async generateDiagram(steps: any[]): Promise<string | null> {
        if (!this.client.apiKey || this.client.apiKey === 'dummy') {
            return null;
        }

        console.log(chalk.cyan('🎨 Generating architectural flow diagram...'));

        const systemPrompt = `
You are an expert diagram-generation and information-extraction model that specializes in architectural flow visuals.

Your task:  
Given a list of execution steps, extract only the meaningful, human-relevant parts of each step and convert them into a clean, modern, visually appealing architecture-style flow diagram.

==========================
      INFORMATION FILTERING
==========================
From each execution step, extract ONLY:
  • Step Number  
  • Thought (summarize < 15 words)  
  • Action / WAIT instruction (summarize < 15 words)  
  • URL (if present)

Ignore and discard entirely:
  • Tool calls  
  • Tool observations  
  • Network data  
  • Raw HTML contents  
  • Console logs  
  • Selector metadata  
  • DOM details  
  • Any technical noise

Your goal is to interpret the intent behind each step, not replicate raw system output.

==========================
      DIAGRAM RULES
==========================

1. OVERALL LAYOUT
- Each step becomes a standalone block/container.  
- Blocks are stacked vertically (unless input implies branching).  
- Use clear directional arrows between blocks to show flow.  
- Layout must be clean, modern, readable, and visually attractive.

2. BLOCK COMPOSITION
Each Step Block includes:
  • Step Number  
  • 💭 Thought bubble (summarized)  
  • ⚙️ Action (WAIT) box (summarized)  
  • 🌐 URL capsule (if provided)

3. STYLE REQUIREMENTS
- Use soft rounded rectangles and pastel color palette.  
- Subtle borders and soft shadows.  
- Smooth arrows between components.  
- Use icons creatively (💭 ⚙️ 🌐).  
- Keep everything visually balanced and non-cluttered.  
- Maintain consistent width and spacing.
- **CRITICAL**: The output MUST be valid HTML/CSS that can be embedded directly into a div. Use inline styles or a <style> block scoped to the diagram container. Do NOT use external CSS files.
- **CRITICAL**: The diagram should fit within a width of roughly 400-500px, but be responsive if possible.

4. CONTENT LIMITATION
- Max 15 words per element.  
- Ensure wording is clean, human-readable, and flows naturally.  
- Do NOT include any technical details not needed for visual understanding.

5. OUTPUT FORMAT
- Produce a single cohesive architecture-style diagram.  
- The diagram must be visually expressive, not a textual list.  
- Creativity is allowed but clarity and structure come first.
- Return ONLY the HTML code for the diagram. Do not wrap in markdown code blocks.

==========================
      INPUT FORMAT
==========================
You will receive:
  • A raw list of execution steps (with Thought, WAIT, URL, and extra fields)

Your job:
  1. Extract meaningful information  
  2. Simplify and compress  
  3. Generate the final architecture-style visual diagram  

==========================

Generate ONLY the final diagram HTML as your output.
`;

        const stepsJson = JSON.stringify(steps.map(s => ({
            stepNumber: s.stepNumber,
            thought: s.thought,
            action: s.action,
            url: s.observation?.state?.url
        })), null, 2);

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Here are the execution steps:\n\n${stepsJson}` }
                ],
                temperature: 0.4,
            });

            let content = response.choices[0]?.message?.content || '';

            // Clean up markdown code blocks if present
            content = content.replace(/```html/g, '').replace(/```/g, '').trim();

            return content;
        } catch (error: any) {
            console.error(chalk.red(`Failed to generate diagram: ${error.message}`));
            return null;
        }
    }
}
