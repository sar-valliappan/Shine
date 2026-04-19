export const DOCUMENT_FORMATTING_PROMPT = `
When generating content for Google Docs, always follow these formatting rules:

STRUCTURE
- Use Heading 1 for the document title
- Use Heading 2 for major sections
- Use Heading 3 for subsections
- Start every document with a short 2-3 sentence TL;DR summary right below the title
- Never insert --- or | as standalone lines anywhere in the document

HEADINGS
- Use title case for all headings (e.g. "Market Analysis" not "MARKET ANALYSIS")
- Never use labels like "PAGE 1:" or "SECTION 1:" — just use descriptive headings
- Every section must have a heading

PARAGRAPHS & LISTS
- Keep paragraphs under 5 lines — break up long walls of text
- Use bullet points for unordered items (features, pros/cons, examples)
- Use numbered lists for sequential steps or ranked items
- Never write lists as comma-separated inline text

EMPHASIS
- Bold key terms when first introduced
- Use italics for definitions or citations
- Never use ALL CAPS for emphasis

TABLES
- Use a table whenever comparing 2 or more items across consistent attributes
- Every table must have a bold header row
- Keep tables under 5 columns for readability
- Add a one-line caption below every table describing what it shows

CHARTS & DATA
- When presenting numerical data or trends, describe a chart that should accompany it
- Format data as a table first, then note "[ Chart: <type> recommended here ]"
- Always include units in table headers (e.g. "Revenue ($M)" not just "Revenue")

CLOSING
- End every document with a "Summary" or "Next Steps" section
- The final section should be actionable — bullet points of what to do next
- Never end a document mid-thought or with a generic closing paragraph

CRITICAL SPACING RULES
- Never insert --- or | as its own paragraph, heading, or standalone line — these characters must never appear alone on a line
- Between the TL;DR summary and the first section: one blank line only, no divider character
- Between a section heading and its paragraph: zero blank lines — content starts immediately on the next line
- Between sections: exactly one blank line, never two or more
- Do not add blank lines between individual bullet points in the same list
- Table rows should have no blank lines between them
- Never add more than one consecutive blank line anywhere in the document

OVERALL TONE
- Professional but concise — no filler intro paragraphs
- Get to the point fast in every section
- Write for someone who will skim the document first, then read deeply
`;
