import { AgentObservation, AgentAction, AgentHistory, DatabaseContext } from './types';

export function buildPrompt(
  bugDescription: string,
  currentObservation: AgentObservation,
  history: AgentHistory,
  databaseEnabled: boolean = false,
  databaseContext?: DatabaseContext
): string {
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
    ? `\nConsole Errors:\n${currentObservation.state.consoleErrors.slice(-5).map((e: string) => `- ${e}`).join('\n')}`
    : '\nConsole Errors: None';

  // Database information
  let databaseInfo = '';
  if (databaseEnabled && databaseContext) {
    databaseInfo = `\n\nDatabase Query Capability: ENABLED
Available Collections: ${databaseContext.collections?.join(', ') || 'None'}`;
    
    if (databaseContext.lastQueryResult) {
      databaseInfo += `\n\nPrevious Database Query Result:
${JSON.stringify(databaseContext.lastQueryResult, null, 2).substring(0, 500)}...`;
    }
  }

  // Database query result from current observation
  let dbQueryResultInfo = '';
  if (currentObservation.dbQueryResult) {
    dbQueryResultInfo = `\n\nDatabase Query Result from Previous Step:
${JSON.stringify(currentObservation.dbQueryResult, null, 2).substring(0, 500)}...`;
  }

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

${consoleErrors}${databaseInfo}${dbQueryResultInfo}

Your task:
1. Analyze the current state and available elements
2. Decide the next best action to reproduce the bug
3. Return a JSON response with your reasoning and action

Available Actions:
- click: Click on an element (use selector from available elements)
- input: Type text into an input field (requires selector and text)
- wait: Wait for something to load (use sparingly)
- navigate: Navigate to a different URL (requires url)${databaseEnabled ? `
- query_database: Query the database to inspect data state (useful for debugging data-related bugs)` : ''}

Response Format (JSON only, no markdown):
{
  "thought": "Analysis of current state. If you have performed the action and the observed behavior matches the bug description (e.g., error appeared, nothing happened, wrong state), set status to 'reproduced'.",
  "action": {
    "type": "click|input|wait|navigate${databaseEnabled ? '|query_database' : ''}",
    "selector": "selector from available elements",
    "target": "human-readable description of target",
    "text": "text to input (only for input action)",
    "url": "url to navigate to (only for navigate action)"${databaseEnabled ? `,
    "dbQuery": {
      "collection": "collection name",
      "operation": "find|findOne|aggregate|getSchema|listCollections",
      "query": {/* MongoDB query object */},
      "pipeline": [/* aggregation pipeline for aggregate operation */],
      "options": {/* query options like limit, sort, etc */}
    } // only for query_database action` : ''}
  },
  "status": "in_progress" | "reproduced" | "failed",
  "reason": "REQUIRED if status is reproduced: Explain exactly what happened and how it matches the bug description"
}

CRITICAL INSTRUCTIONS:
1. CHECK HISTORY: Review 'Recent Actions Taken'. If you have already performed the action that is supposed to trigger the bug, check the current state.
2. MATCH BUG: Does the current state match the BUG DESCRIPTION?
   - If the bug is "X does not happen", and you did the action and X didn't happen -> REPRODUCED.
   - If the bug is "Error Y appears", and you see Error Y -> REPRODUCED.
3. STOP LOOPING: Do not repeat the same action more than twice if the state isn't changing. If the expected happy path isn't working, that IS the bug.
4. DETECT FAILURE: If an action produces no visible change when it should, that confirms the bug. Mark as 'reproduced'.`;
}

