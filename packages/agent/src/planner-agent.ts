import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";

export const PlanStepSchema = z.object({
  stepNumber: z.number().describe("The sequence number of the step"),
  description: z.string().describe("Description of the action to perform"),
  expectedOutcome: z.string().describe("What should happen after the action"),
});

export const TestPlanSchema = z.object({
  steps: z.array(PlanStepSchema).describe("List of steps to reproduce the bug"),
});

export type TestPlan = z.infer<typeof TestPlanSchema>;

export class PlannerAgent {
  private model: ChatGoogleGenerativeAI;

  constructor(modelName: string = "gemini-2.5-pro", apiKey?: string) {
    const config: any = {
      model: modelName,
      temperature: 0,
    };

    if (apiKey) config.apiKey = apiKey;

    this.model = new ChatGoogleGenerativeAI(config);
  }

  async createPlan(bugDescription: string): Promise<TestPlan> {
    const parser = StructuredOutputParser.fromZodSchema(TestPlanSchema as any);
    
    const prompt = PromptTemplate.fromTemplate(
      `You are a QA Lead responsible for creating a reproduction plan for a reported bug.
      
      BUG DESCRIPTION:
      {bugDescription}
      
      Create a step-by-step plan to reproduce this bug. 
      Keep steps atomic and clear.
      Focus on user actions (click, type, navigate) and verifications.
      
      {format_instructions}`
    );

    try {
      console.log("Generating test plan...");
      const formattedPrompt = await prompt.format({
        bugDescription,
        format_instructions: parser.getFormatInstructions(),
      });
      console.log("FULL FORMATTED PROMPT PREVIEW:\n", formattedPrompt.substring(0, 1000));

      const llmResult: any = await (this.model as any).invoke(formattedPrompt);
      const text =
        Array.isArray(llmResult.content) && llmResult.content.length > 0
          ? (llmResult.content[0] as any).text ?? JSON.stringify(llmResult.content[0])
          : (llmResult.text ?? JSON.stringify(llmResult));

      const plan = await parser.parse(text);
      return plan as TestPlan;
    } catch (error) {
      console.error("Error creating plan:", error);
      throw new Error("Failed to generate test plan");
    }
  }
}
