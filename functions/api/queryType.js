/**
 * queryType.js — Atkyn Query Classifier
 *
 * Types:
 *   emotional   — genuine distress, heartbreak, grief, mental health
 *   technical   — code, debug, architecture, engineering
 *   factual     — definitions, dates, numbers, quick lookups
 *   analytical  — comparisons, research, multi-part reasoning
 *   casual      — everything else: small talk, advice, fun, relationships, life stuff
 *
 * NOTE: casual is the DEFAULT bucket for most human conversation —
 * relationship advice, "ladki patana", rants, jokes, life decisions.
 * emotional is ONLY for genuine distress signals.
 */

const PATTERNS = {
  // Only GENUINE distress — not casual relationship talk
  emotional: [
    /\b(suicide|suicidal|khatam karna|khatam ho jana|mar jana chahta|depression|depressed|anxiety disorder|panic attack|self harm|khud ko hurt|rone wala|ro raha|roo raha|bahut dard|bahut takleef|heartbroken|toot gaya|toot gayi|akela hoon|akeli hoon|koi nahi|kuch nahi bachha|zindagi bekar|jeena nahi)\b/i,
  ],

  technical: [
    /\b(code|function|class|method|api|bug|error|debug|fix|build|deploy|script|database|query|server|frontend|backend|component|module|import|export|async|await|promise|callback|regex|algorithm|git|docker|kubernetes|linux|bash|shell|npm|pip|flutter|kotlin|jetpack|compose|cloudflare|worker|pages|react|vue|angular|node|python|java|dart|swift|sql|json|xml|http|rest|graphql|websocket|sse|stream|css|html|typescript|kotlin|gradle)\b/i,
    /```|`[^`]+`|\bstack trace\b|\bexception\b/i,
  ],

  factual: [
    /\b(what is|what are|who is|who are|when did|when was|where is|where are|how many|how much|define|definition|kya hai|kaun hai|kab|kitna|kitni|matlab|meaning|full form)\b/i,
    /\b(\d+%|\d+ percent|price|cost|capital|population|distance|height|weight|speed)\b/i,
  ],

  analytical: [
    /\b(compare|comparison|analyze|analysis|pros and cons|advantages|disadvantages|which is better|best way|recommend|strategy|tradeoffs|evaluate|ranking)\b/i,
    /\b(should i|should i buy|should i use|konsa better|kaunsa achha|difference between)\b/i,
  ],

  // casual catches everything else — relationship advice, fun, life, random
  casual: [
    /.*/,
  ],
};

/**
 * Classify a query into one of 5 types.
 * Order matters — most specific first, casual last as catch-all.
 *
 * @param {string} query
 * @returns {'emotional'|'technical'|'factual'|'analytical'|'casual'}
 */
export function classifyQuery(query) {
  const q = query.trim();
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some(rx => rx.test(q))) return type;
  }
  return 'casual';
}

const TYPE_INSTRUCTIONS = {
  emotional: `## ACTIVE MODE: EMOTIONAL
This person is going through something heavy. Rules:
- Plain flowing prose only. No headers, bullets, bold, lists.
- Acknowledge what they're feeling in the first sentence — naturally, not theatrically.
- One grounded, honest response. End cleanly. No moral punchline.
- Feel like one person texting another. Warm, real, present.
- Match their language exactly — Hinglish, Hindi, English, whatever they used.`,

  technical: `## ACTIVE MODE: TECHNICAL
This is a technical or coding query. Rules:
- Code block first, always. Correct language tag on the fence.
- Brief architectural note after — no line-by-line narration.
- Never invent non-existent APIs or deprecated methods.
- Skip basics if query shows expertise. Go straight to the solution.
- If debugging: state root cause first, then fix.`,

  factual: `## ACTIVE MODE: FACTUAL
Direct factual query. Rules:
- Answer in 1–3 sentences or a single value. No intro paragraph.
- Use KaTeX inline ($...$) for any numeric expression or formula.
- If uncertain or time-sensitive, say so in one short clause.`,

  analytical: `## ACTIVE MODE: ANALYTICAL
Comparative or research query. Rules:
- Use ## headings only when response genuinely has multiple distinct sections.
- Use a Markdown table when comparing 3+ items across 2+ attributes.
- Numbered steps only when order matters.
- State recommendation or conclusion directly — no endless hedging.`,

  casual: `## ACTIVE MODE: CASUAL
Natural everyday conversation — could be small talk, relationship advice, life questions,
fun stuff, or anything that doesn't fit technical/factual/analytical buckets. Rules:
- Reply like a smart friend texting back. Natural, warm, direct.
- Match their energy — chill if they're chill, fun if they're being fun.
- No unnecessary formatting. Pure conversational prose.
- For relationship/life advice: give real, honest takes — not generic platitudes.
- Short for simple things. Longer only if the topic genuinely needs it.
- Match their language exactly — Hinglish stays Hinglish, Hindi stays Hindi.`,
};

/**
 * Returns the instruction block for a given query type.
 * @param {string} type
 * @returns {string}
 */
export function getTypeInstruction(type) {
  return TYPE_INSTRUCTIONS[type] ?? TYPE_INSTRUCTIONS.casual;
}
