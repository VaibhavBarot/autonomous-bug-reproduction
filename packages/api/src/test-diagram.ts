import { DiagramGenerator } from './diagram-generator';
import dotenv from 'dotenv';
import path from 'path';

// Load env from root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function test() {
    console.log('Testing DiagramGenerator...');
    const generator = new DiagramGenerator();

    const mockSteps = [
        {
            stepNumber: 1,
            thought: "I need to navigate to the homepage.",
            action: { type: "navigate", selector: "url" },
            observation: { state: { url: "http://localhost:3000" } }
        },
        {
            stepNumber: 2,
            thought: "I see a product list. I will click on the first product.",
            action: { type: "click", selector: ".product-card" },
            observation: { state: { url: "http://localhost:3000/product/1" } }
        }
    ];

    const diagram = await generator.generateDiagram(mockSteps);
    console.log('Result:', diagram);
}

test().catch(console.error);
