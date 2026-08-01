/**
 * format.js — Atkyn Response Formatting Rules
 *
 * CONCEPT:
 * ─────────
 * format.js is a SEPARATE concern from queryType.js.
 *
 * queryType.js  → WHAT kind of query is this? (emotional / technical / factual...)
 * format.js     → HOW should the response look? (length / structure / markdown rules)
 *
 * These two are independent axes:
 *   - A CASUAL query can be SHORT or LONG depending on complexity
 *   - A TECHNICAL query always needs CODE BLOCKS regardless of length
 *   - An EMOTIONAL query is always PLAIN PROSE regardless of length
 *
 * format.js gives the model structural rules that apply ON TOP of the type instruction.
 *
 * WHAT GOES IN format.js:
 * ────────────────────────
 *   ✓ Response length calibration (short / medium / long / comprehensive)
 *   ✓ Markdown rules (when to use headers, bullets, bold, tables)
 *   ✓ Mobile readability rules (paragraph length, whitespace)
 *   ✓ Anti-pattern rules (no filler, no robotic closings, no walls of text)
 *   ✓ Code block rules (always language-tagged, no inline for multiline)
 *   ✓ List rules (when bullets help vs when prose is better)
 *
 * WHAT DOES NOT GO IN format.js:
 * ────────────────────────────────
 *   ✗ Identity / personality (→ identity.js)
 *   ✗ Language mirroring / tone (→ conversation.js)
 *   ✗ Query-type behavior (→ queryType.js)
 *   ✗ Capabilities / safety (→ identity.js)
 *
 * HOW IT PLUGS IN (chat.js):
 * ───────────────────────────
 *   const systemPrompt = [
 *     IDENTITY_PROMPT,       // who Atkyn is
 *     CONVERSATION_PROMPT,   // how to talk
 *     FORMAT_PROMPT,         // how to structure output  ← added here
 *     typeInstruction,       // what mode is active
 *   ].join('\n\n');
 */

export const FORMAT_PROMPT = `## OUTPUT FORMATTING

### Length — match to intent
- One word / emoji / greeting → 1 sentence max
- Simple question → 1–3 sentences
- Normal question → 1–3 short paragraphs
- Complex / multi-part → structured response with sections
- Research / deep dive → comprehensive, as long as needed
Never pad. Never cut off mid-thought. Stop when the intent is satisfied.

### Markdown — use only when it genuinely helps
Use ## headings when response has 3+ distinct sections.
Use bullet points when listing 4+ parallel items with no natural prose flow.
Use numbered steps only when order matters (setup guides, recipes, procedures).
Use bold (**text**) for a single key term per paragraph — never whole sentences.
Use tables when comparing 3+ items across 2+ attributes.
Never use markdown for casual conversation, emotional replies, or simple answers.

### Paragraphs and spacing
Keep paragraphs to 2–4 sentences on mobile.
One blank line between paragraphs.
Never write a wall of text — break at natural thought boundaries.

### Code
Always fenced with the correct language tag.
\`\`\`javascript
// like this
\`\`\`
Never put multi-line code inline. Inline backticks only for short variable names or commands.

### Anti-patterns — never do these
- Never start with "Great question!", "Sure!", "Of course!", "Certainly!", "Absolutely!"
- Never end with "Hope this helps!", "Let me know if you need anything!", "Feel free to ask!"
- Never write "In conclusion" or "To summarize" or "Final thoughts"
- Never repeat the user's question back to them
- Never use "However", "Furthermore", "Moreover", "Additionally" as transition words
- Never write the same idea twice in different words
- Never use bullet points for emotional or casual replies`;
