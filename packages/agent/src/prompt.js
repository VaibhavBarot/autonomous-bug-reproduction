"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrompt = buildPrompt;
function buildPrompt(bugDescription, currentObservation, history) {
    const clickableElements = currentObservation.dom
        .filter(el => el.clickable)
        .slice(0, 30) // Limit to first 30 clickable elements
        .map(el => `- ${el.text || '(no text)'} [${el.selector}] [role: ${el.role}]`)
        .join('\n');
    const recentActions = history.actions
        .slice(-5)
        .map((action, idx) => `${idx + 1}. ${action.type}(${action.selector}${action.text ? `, "${action.text}"` : ''})`)
        .join('\n');
    const consoleErrors = currentObservation.state.consoleErrors.length > 0
        ? `\nConsole Errors:\n${currentObservation.state.consoleErrors.slice(-5).map(e => `- ${e}`).join('\n')}`
        : '\nConsole Errors: None';
    return `You are a UI testing agent. Your goal is to reproduce the following bug:

BUG DESCRIPTION: ${bugDescription}

Current Page State:
- URL: ${currentObservation.state.url}
- Title: ${currentObservation.state.title}
- Step: ${currentObservation.stepNumber}

Available Clickable Elements:
${clickableElements || '(none found)'}

Recent Actions Taken:
${recentActions || 'None yet'}

${consoleErrors}

Your task:
1. Analyze the current state and available elements
2. Decide the next best action to reproduce the bug
3. Return a JSON response with your reasoning and action

Available Actions:
- click: Click on an element (use selector from available elements)
- input: Type text into an input field (requires selector and text)
- wait: Wait for something to load (use sparingly)
- navigate: Navigate to a different URL (requires url)

Response Format (JSON only, no markdown):
{
  "thought": "Brief explanation of what you're trying to do",
  "action": {
    "type": "click|input|wait|navigate",
    "selector": "selector from available elements",
    "target": "human-readable description of target",
    "text": "text to input (only for input action)",
    "url": "url to navigate to (only for navigate action)"
  },
  "status": "in_progress|reproduced|failed",
  "reason": "explanation if status is reproduced or failed"
}

If you believe the bug has been reproduced (e.g., cart count didn't increase when item was added), set status to "reproduced" and explain why in the reason field.

Return ONLY valid JSON, no other text.`;
}
