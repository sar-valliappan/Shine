import { GoogleGenerativeAI } from '@google/generative-ai';
import { DOCUMENT_FORMATTING_PROMPT } from '../prompts/documentFormatting.js';

interface FormattedBlock {
  text: string;
  namedStyle: 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'NORMAL_TEXT';
  isBullet: boolean;
  isNumbered: boolean;
  boldRanges: Array<{ start: number; end: number }>;
}

function stripBold(text: string): { clean: string; boldRanges: Array<{ start: number; end: number }> } {
  const boldRanges: Array<{ start: number; end: number }> = [];
  let clean = '';
  let boldStart = -1;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      if (boldStart === -1) { boldStart = clean.length; }
      else { boldRanges.push({ start: boldStart, end: clean.length }); boldStart = -1; }
      i += 2;
    } else {
      clean += text[i];
      i++;
    }
  }

  return { clean, boldRanges };
}

function parseMarkdown(markdown: string): FormattedBlock[] {
  return markdown.split('\n').map((rawLine) => {
    const line = rawLine.trimEnd();
    let namedStyle: FormattedBlock['namedStyle'] = 'NORMAL_TEXT';
    let isBullet = false;
    let isNumbered = false;
    let text = line;

    if (line.startsWith('### '))      { namedStyle = 'HEADING_3'; text = line.slice(4); }
    else if (line.startsWith('## ')) { namedStyle = 'HEADING_2'; text = line.slice(3); }
    else if (line.startsWith('# '))  { namedStyle = 'HEADING_1'; text = line.slice(2); }
    else if (line.startsWith('- ') || line.startsWith('* ')) { isBullet = true; text = line.slice(2); }
    else if (/^\d+\.\s/.test(line)) { isNumbered = true; text = line.replace(/^\d+\.\s/, ''); }
    else if (line === '---') { text = ''; } // skip horizontal rules (not supported in Docs API)

    const { clean, boldRanges } = stripBold(text);
    return { text: clean, namedStyle, isBullet, isNumbered, boldRanges };
  });
}

export function buildDocRequests(markdown: string): any[] {
  const blocks = parseMarkdown(markdown);
  const requests: any[] = [];

  // Build full text and track 1-indexed positions for each block
  let fullText = '';
  const positions: Array<{ start: number; end: number; block: FormattedBlock }> = [];

  for (const block of blocks) {
    const start = fullText.length + 1; // Google Docs is 1-indexed
    fullText += block.text + '\n';
    positions.push({ start, end: fullText.length, block });
  }

  if (!fullText.trim()) return [];

  // Single insertText for the whole document
  requests.push({ insertText: { location: { index: 1 }, text: fullText } });

  // Paragraph styles and bold — applied after insertion
  for (const { start, end, block } of positions) {
    if (!block.text) continue;

    if (block.namedStyle !== 'NORMAL_TEXT') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { namedStyleType: block.namedStyle },
          fields: 'namedStyleType',
        },
      });
    }

    for (const { start: bs, end: be } of block.boldRanges) {
      if (be > bs) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: start + bs, endIndex: start + be },
            textStyle: { bold: true },
            fields: 'bold',
          },
        });
      }
    }
  }

  // Bullet runs — group consecutive bullet blocks
  let bulletRunStart: number | null = null;

  for (let i = 0; i < positions.length; i++) {
    const { start, end, block } = positions[i];
    const nextIsBullet = i + 1 < positions.length && positions[i + 1].block.isBullet;

    if (block.isBullet && bulletRunStart === null) bulletRunStart = start;

    if (bulletRunStart !== null && block.isBullet && !nextIsBullet) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: bulletRunStart, endIndex: end },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
      bulletRunStart = null;
    }
  }

  // Numbered list runs
  let numberedRunStart: number | null = null;

  for (let i = 0; i < positions.length; i++) {
    const { start, end, block } = positions[i];
    const nextIsNumbered = i + 1 < positions.length && positions[i + 1].block.isNumbered;

    if (block.isNumbered && numberedRunStart === null) numberedRunStart = start;

    if (numberedRunStart !== null && block.isNumbered && !nextIsNumbered) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: numberedRunStart, endIndex: end },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        },
      });
      numberedRunStart = null;
    }
  }

  return requests;
}

/** Re-map batch requests built for index 1 so they apply at the end of an existing document. */
export function shiftDocRequestsToEnd(requests: any[], endIndex: number): any[] {
  return requests.map((r: any) => {
    if (r.insertText?.location?.index !== undefined) {
      return { ...r, insertText: { ...r.insertText, location: { index: endIndex } } };
    }
    if (r.updateParagraphStyle?.range) {
      const offset = endIndex - 1;
      return {
        ...r,
        updateParagraphStyle: {
          ...r.updateParagraphStyle,
          range: {
            startIndex: r.updateParagraphStyle.range.startIndex + offset,
            endIndex: r.updateParagraphStyle.range.endIndex + offset,
          },
        },
      };
    }
    if (r.updateTextStyle?.range) {
      const offset = endIndex - 1;
      return {
        ...r,
        updateTextStyle: {
          ...r.updateTextStyle,
          range: {
            startIndex: r.updateTextStyle.range.startIndex + offset,
            endIndex: r.updateTextStyle.range.endIndex + offset,
          },
        },
      };
    }
    if (r.createParagraphBullets?.range) {
      const offset = endIndex - 1;
      return {
        ...r,
        createParagraphBullets: {
          ...r.createParagraphBullets,
          range: {
            startIndex: r.createParagraphBullets.range.startIndex + offset,
            endIndex: r.createParagraphBullets.range.endIndex + offset,
          },
        },
      };
    }
    return r;
  });
}

/** Row-major cell insertion indices (inside each cell), after insertTable. */
export function collectTableCellInsertionIndices(body: { content?: any[] } | undefined): number[] | null {
  const content = body?.content;
  if (!content) return null;
  let lastTable: any = null;
  for (const el of content) {
    if (el.table) lastTable = el.table;
  }
  if (!lastTable?.tableRows?.length) return null;
  const indices: number[] = [];
  for (const row of lastTable.tableRows) {
    for (const cell of row.tableCells ?? []) {
      const first = cell.content?.[0];
      if (first?.startIndex != null) indices.push(Number(first.startIndex) + 1);
    }
  }
  return indices.length ? indices : null;
}

export async function generateDocumentContent(
  title: string,
  contentPrompt: string,
  apiKey: string,
): Promise<string> {
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemma-3-27b-it' });

    const instruction = `${DOCUMENT_FORMATTING_PROMPT}

Generate a complete, well-structured document titled "${title}".
Content description: ${contentPrompt}

Use markdown formatting:
- # for the document title (Heading 1) — use only once at the top
- ## for major sections (Heading 2)
- ### for subsections (Heading 3)
- **text** for bold key terms
- - item for bullet points
- 1. item for numbered lists

Return only the markdown content. No code fences, no explanations.`;

    const result = await model.generateContent(instruction);
    return result.response
      .text()
      .trim()
      .replace(/^```markdown\n?/i, '')
      .replace(/^```\n?/i, '')
      .replace(/```\s*$/i, '')
      .split('\n')
      .filter((line) => !/^\s*[-|]{2,}\s*$/.test(line)) // strip stray --- and ||| lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'); // collapse 3+ consecutive blank lines to max 2
  } catch (err) {
    console.error('[generateDocumentContent] error:', err);
    return `# ${title}\n\n${contentPrompt}`;
  }
}
