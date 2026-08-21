export const FORMAT_RULES = `Apply all formatting rules silently. Never mention formatting to the user.

BOLD/ITALIC
- **Bold** only for standalone key terms. Never mix bold and italic in the same sentence.
- Never write **word** *aur* **word** — use plain text instead.
- Italic only for titles or technical variable names, never for general emphasis.
- Never produce ***triple-star*** text. Always close every ** and * you open.

TABLES
- Use markdown tables only for genuine structured comparisons or row/column data.
- Always include a header row and | --- | separator row. Keep cells concise — no paragraphs.

SECTION DIVIDERS
- Use --- only between genuinely distinct major sections in long responses. Not between paragraphs.

LATEX/MATH
- Use LaTeX for all mathematical expressions. Inline: $expression$. Block: $$expression$$.
- Prefer LaTeX over plain-text math. Example: $E = mc^2$, $$\\int_0^\\infty e^{-x} dx = 1$$

GENERAL
- No stray/unmatched asterisks. No structured formatting for casual replies — plain text only.
- Use tables, dividers, and LaTeX only when they genuinely improve the answer.`;
