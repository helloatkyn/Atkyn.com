/**
 * queryType.js — Atkyn Query Classifier
 *
 * Classifies incoming query into one of 5 types using keyword/pattern matching.
 * Returns a type string + a focused instruction block to append to the system prompt.
 * Zero extra API calls. Zero latency cost.
 *
 * Types:
 *   emotional   — feelings, relationships, personal struggles
 *   technical   — code, debug, architecture, engineering
 *   factual     — definitions, dates, numbers, quick lookups
 *   analytical  — comparisons, research, multi-part reasoning
 *   casual      — small talk, greetings, random conversation
 */

const PATTERNS = {
  emotional: [
    /\b(feel|feeling|felt|sad|happy|angry|anxious|lonely|depressed|heartbreak|heartbroken|miss|missing|love|pyaar|dard|hurt|cry|crying|rone|rona|dil|relationship|breakup|crush|life sucks|kya karoon|samajh nahi|lost|hopeless|scared|fear|worried|stress|stressed|overwhelmed)\b/i,
    /\b(wo|woh|usse|unhe|mujhe|meri|mera)\b.{0,40}\b(nahi|nhi|kyun|kyu|kya)\b/i,
  ],
  technical: [
    /\b(code|function|class|method|api|bug|error|debug|fix|build|deploy|script|database|query|server|frontend|backend|component|module|import|export|async|await|promise|callback|regex|algorithm|git|docker|kubernetes|linux|bash|shell|npm|pip|flutter|kotlin|jetpack|compose|cloudflare|worker|pages|react|vue|angular|node|python|java|dart|swift|sql|json|xml|http|rest|graphql|websocket|sse|stream)\b/i,
    /```|`[^`]+`|\berror\b|\bexception\b|\bstack trace\b/i,
  ],
  factual: [
    /\b(what is|what are|who is|who are|when did|when was|where is|where are|how many|how much|define|definition|explain|kya hai|kaun hai|kab|kitna|kitni|matlab|meaning|full form|difference between|vs\b)\b/i,
    /\b(\d+%|\d+ percent|price|cost|rate|value|capital|population|distance|height|weight|speed|temperature)\b/i,
  ],
  analytical: [
    /\b(compare|comparison|analyze|analysis|pros and cons|advantages|disadvantages|should i|which is better|best way|recommend|strategy|plan|research|breakdown|overview|tradeoffs|decision|evaluate|assessment|ranking|vs\b)\b/i,
    /\b(kyun|kyu).{0,30}\b(better|best|sahi|achha|acha|theek)\b/i,
  ],
  casual: [
    /^(hi|hey|hello|hii|helo|heyy|yo|sup|wassup|kya haal|kaise ho|kaisa hai|thik ho|bhai|yaar|dude|ok|okay|hmm|lol|haha|nice|cool|acha|achha|theek hai|hn|haan|nahi|nope|yes|no|sure|yep|nah)\W*$/i,
  ],
};

/**
 * Classify a query string into one of the 5 types.
 * Falls back to 'analytical' if nothing matches — it's the most general handler.
 *
 * @param {string} query
 * @returns {'emotional'|'technical'|'factual'|'analytical'|'casual'}
 */
export function classifyQuery(query) {
  const q = query.trim();

  for (const [type, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some(rx => rx.test(q))) return type;
  }

  return 'analytical';
}

/**
 * Per-type instruction blocks injected after the base prompts.
 * Tells the model exactly how to format and tone this specific query.
 */
const TYPE_INSTRUCTIONS = {
  emotional: `## ACTIVE MODE: EMOTIONAL
This is a personal or emotional message. Rules:
- Plain flowing prose only. No headers, no bullet points, no bold, no lists.
- Validate the feeling in the first sentence naturally — not theatrically.
- Give one grounded, honest insight. End cleanly. No preachy moral at the end.
- Feel like one person texting another, not a counsellor reading from a script.
- Short and warm for simple feelings. If depth is genuinely needed, use short numbered steps only — never paragraphs.
- Respond in the exact same language the user used.`,

  technical: `## ACTIVE MODE: TECHNICAL
This is a technical or coding query. Rules:
- Code block first, always. Use the correct language tag on the fence.
- Brief architectural note after the code — no line-by-line narration.
- Never invent non-existent APIs. Never use deprecated methods.
- Skip fundamentals if the user's message shows expertise. Go straight to the solution.
- If the query involves debugging, state the root cause first, then the fix.`,

  factual: `## ACTIVE MODE: FACTUAL
This is a factual or definitional query. Rules:
- Answer directly in 1 to 3 sentences or a single value.
- No intro paragraph. No recap of the question.
- Use KaTeX inline ($...$) for any numeric expression or formula.
- If the fact is uncertain or time-sensitive, say so in one short clause.`,

  analytical: `## ACTIVE MODE: ANALYTICAL
This is a comparative, research, or multi-part query. Rules:
- Use ## headings only when the response genuinely has multiple distinct sections.
- Use a Markdown table when comparing 3 or more items across 2 or more attributes.
- Numbered steps only when order matters. Skip intro paragraphs.
- State your recommendation or conclusion directly — do not hedge endlessly.
- Match depth to what the user actually needs. Do not write an essay if a paragraph suffices.`,

  casual: `## ACTIVE MODE: CASUAL
This is casual small talk or a simple greeting. Rules:
- Reply briefly and naturally, 1 to 2 sentences maximum.
- Match the user's energy exactly. Chill if they are chill.
- No formatting whatsoever. Pure conversational text.
- Do not pad, do not offer help lists, do not ask what they need unless it flows naturally.`,
};

/**
 * Returns the instruction block for a given query type.
 *
 * @param {'emotional'|'technical'|'factual'|'analytical'|'casual'} type
 * @returns {string}
 */
export function getTypeInstruction(type) {
  return TYPE_INSTRUCTIONS[type] ?? TYPE_INSTRUCTIONS.analytical;
}
