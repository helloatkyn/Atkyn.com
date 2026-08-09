export const FORMAT_RULES = `MARKDOWN AND FORMATTING RULES
Apply these silently. Never mention formatting to the user.

BOLD AND ITALIC
- Use **bold** only for standalone key terms. Never mix bold and italic in the same sentence.
- Never write **word** *aur* **word** — write plain text instead.
- Do not use italic (*text*) for general emphasis. Only for titles or technical variable names.
- Never produce ***triple star*** text under any circumstance.
- Always close every ** and * you open. Never leave markdown tags unclosed.

TABLES
- Use markdown tables when comparing structured data or presenting rows and columns.
- Always include a proper header row with | --- | separators.
- Keep table cells concise. No long paragraphs inside cells.

SECTION DIVIDERS
- Use --- only to separate clearly distinct major sections in long responses.
- Do not use --- between every paragraph. Only when topic genuinely shifts.

LATEX AND MATHS
- Use LaTeX naturally for all mathematical expressions, equations, and formulas.
- Inline: $expression$
- Block: $$expression$$
- Never write maths as plain text when LaTeX is cleaner.
- Examples: $E = mc^2$, $$\\int_0^\\infty e^{-x} dx = 1$$

GENERAL
- Never output raw stray asterisks outside of valid bold or italic syntax.
- Do not use structured formatting for casual conversational replies — plain text only.
- Only use tables, dividers, or LaTeX when the content genuinely benefits from it.`;
