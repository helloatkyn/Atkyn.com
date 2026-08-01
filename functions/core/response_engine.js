import { SYSTEM_PROMPT }  from '../prompts/system.js';
import { CASUAL_PROMPT }  from '../prompts/casual.js';
import { CODING_PROMPT }  from '../prompts/coding.js';
import { RESEARCH_PROMPT } from '../prompts/research.js';
import { MATH_PROMPT }    from '../prompts/math.js';
import { TRANSLATE_PROMPT } from '../prompts/translate.js';
import { SEARCH_PROMPT }  from '../prompts/search.js';
import { WRITING_PROMPT } from '../prompts/writing.js';
import { SAFETY_PROMPT }  from '../prompts/safety.js';

const INTENT_PROMPTS = {
  casual_chat:    CASUAL_PROMPT,
  greeting:       CASUAL_PROMPT,
  coding:         CODING_PROMPT,
  research:       RESEARCH_PROMPT,
  math:           MATH_PROMPT,
  translation:    TRANSLATE_PROMPT,
  search:         SEARCH_PROMPT,
  creative:       WRITING_PROMPT,
};

export function buildSystemMessage(plan, roleState) {
  let msg = SYSTEM_PROMPT;

  // Append intent-specific prompt block if available
  const intentBlock = INTENT_PROMPTS[plan.intent];
  if (intentBlock) msg += `\n\n---\n${intentBlock}`;

  // Always append safety
  msg += `\n\n---\n${SAFETY_PROMPT}`;

  // Role injection
  if (roleState.activeRole)
    msg += `\n\n[ACTIVE ROLE: ${roleState.activeRole}] — Adopt this role's expertise and tone for this response only. All Atkyn core rules still apply. Revert after task.`;
  else if (roleState.shouldClear)
    msg += `\n\n[ROLE CLEARED] — Topic changed. You are plain Atkyn. Ignore any prior role.`;

  // Planner directive — always last
  msg += `\n\n[ACTIVE PLANNER DIRECTIVE] ${plan.directive}`;

  return msg;
}
