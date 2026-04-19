/**
 * Structural helpers for Google Docs `documents.get` body.content.
 * Pair with `documents.batchUpdate`.
 */

export type DocIndexRange = { startIndex: number; endIndex: number };

export function getBodyEndInsertIndex(content: unknown[] | undefined): number {
	if (!content?.length) return 1;
	const last = content[content.length - 1] as { endIndex?: number | null };
	return (last?.endIndex ?? 2) - 1;
}

export function getBodyClearRange(content: unknown[] | undefined): DocIndexRange | null {
	if (!content?.length) return null;
	const last = content[content.length - 1] as { endIndex?: number | null };
	const docEnd = last?.endIndex;
	if (docEnd == null || docEnd < 3) return null;
	const endExclusive = docEnd - 1;
	if (endExclusive <= 1) return null;
	return { startIndex: 1, endIndex: endExclusive };
}

export function findTextRangeInBody(
	content: unknown[] | undefined,
	search: string,
	opts?: { matchCase?: boolean },
): DocIndexRange | null {
	if (!content?.length || !search) return null;
	const needle = opts?.matchCase ? search : search.toLowerCase();

	const scanParagraph = (paragraph: { elements?: unknown[] } | undefined): DocIndexRange | null => {
		for (const raw of paragraph?.elements ?? []) {
			const el = raw as {
				startIndex?: number | null;
				endIndex?: number | null;
				textRun?: { content?: string | null };
			};
			const t = el.textRun?.content;
			if (typeof t !== 'string' || el.startIndex == null || el.endIndex == null) continue;
			const hay = opts?.matchCase ? t : t.toLowerCase();
			const i = hay.indexOf(needle);
			if (i !== -1) {
				const start = el.startIndex + i;
				const end = start + search.length;
				if (end <= el.endIndex) return { startIndex: start, endIndex: end };
			}
		}
		return null;
	};

	const walk = (elements: unknown[] | undefined): DocIndexRange | null => {
		for (const raw of elements ?? []) {
			const structural = raw as {
				paragraph?: { elements?: unknown[] };
				table?: { tableRows?: unknown[] };
			};
			if (structural.paragraph) {
				const hit = scanParagraph(structural.paragraph);
				if (hit) return hit;
			}
			if (structural.table?.tableRows) {
				for (const row of structural.table.tableRows as Array<{ tableCells?: unknown[] }>) {
					for (const cell of row.tableCells ?? []) {
						const inner = walk((cell as { content?: unknown[] }).content);
						if (inner) return inner;
					}
				}
			}
		}
		return null;
	};

	return walk(content);
}

export type DocParagraphExcerpt = {
	style: string;
	text: string;
	startIndex: number;
	endIndex: number;
};

export type DocSectionExcerpt = {
	headingText: string;
	headingStyle: string;
	headingLevel: number;
	sectionStartIndex: number;
	sectionEndExclusive: number;
	paragraphs: DocParagraphExcerpt[];
};

export type ExtractedDocumentContext = {
	contextString: string;
	sections: DocSectionExcerpt[];
};

function joinParagraphText(paragraph: { elements?: unknown[] } | undefined): string {
	return (paragraph?.elements ?? [])
		.map((raw) => {
			const e = raw as { textRun?: { content?: string | null } };
			return typeof e?.textRun?.content === 'string' ? e.textRun.content : '';
		})
		.join('');
}

function collectFlatParagraphs(elements: unknown[] | undefined, out: DocParagraphExcerpt[]): void {
	for (const raw of elements ?? []) {
		const el = raw as {
			startIndex?: number | null;
			endIndex?: number | null;
			paragraph?: { elements?: unknown[]; paragraphStyle?: { namedStyleType?: string | null } };
			table?: { tableRows?: unknown[] };
		};
		if (el.paragraph && el.startIndex != null && el.endIndex != null) {
			const style = el.paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT';
			const text = joinParagraphText(el.paragraph).replace(/\n+$/g, '');
			out.push({ style, text, startIndex: el.startIndex, endIndex: el.endIndex });
		}
		if (el.table?.tableRows) {
			for (const row of el.table.tableRows as Array<{ tableCells?: unknown[] }>) {
				for (const cell of row.tableCells ?? []) {
					collectFlatParagraphs((cell as { content?: unknown[] }).content, out);
				}
			}
		}
	}
}

export function outlineLevelFromNamedStyle(style: string): number | null {
	if (style === 'TITLE' || style === 'SUBTITLE') return -1;
	const m = /^HEADING_(\d)$/.exec(style);
	if (m) return parseInt(m[1], 10);
	return null;
}

function shouldCloseSectionForNextHeading(nextLvl: number, current: DocSectionExcerpt): boolean {
	if (current.headingLevel < 0 && nextLvl < 0) return nextLvl <= current.headingLevel;
	if (current.headingLevel < 0) return nextLvl >= 1;
	return nextLvl <= current.headingLevel;
}

function buildSectionsFromFlatParagraphs(flat: DocParagraphExcerpt[]): DocSectionExcerpt[] {
	const sections: DocSectionExcerpt[] = [];
	let preamble: DocParagraphExcerpt[] = [];
	let current: DocSectionExcerpt | null = null;

	const pushPreambleIfAny = () => {
		if (!preamble.length) return;
		const start = preamble[0].startIndex;
		const end = preamble[preamble.length - 1].endIndex;
		sections.push({
			headingText: '',
			headingStyle: 'PREAMBLE',
			headingLevel: 999,
			sectionStartIndex: start,
			sectionEndExclusive: end,
			paragraphs: preamble.map((p) => ({ ...p })),
		});
		preamble = [];
	};

	const flushCurrent = (endExclusive: number) => {
		if (!current) return;
		current.sectionEndExclusive = endExclusive;
		sections.push(current);
		current = null;
	};

	for (const p of flat) {
		const lvl = outlineLevelFromNamedStyle(p.style);
		if (lvl !== null) {
			if (current && shouldCloseSectionForNextHeading(lvl, current)) flushCurrent(p.startIndex);
			pushPreambleIfAny();
			current = {
				headingText: p.text.trim(),
				headingStyle: p.style,
				headingLevel: lvl,
				sectionStartIndex: p.startIndex,
				sectionEndExclusive: p.endIndex,
				paragraphs: [{ style: p.style, text: p.text, startIndex: p.startIndex, endIndex: p.endIndex }],
			};
		} else if (current) {
			current.paragraphs.push({ style: p.style, text: p.text, startIndex: p.startIndex, endIndex: p.endIndex });
			current.sectionEndExclusive = p.endIndex;
		} else {
			preamble.push({ style: p.style, text: p.text, startIndex: p.startIndex, endIndex: p.endIndex });
		}
	}

	if (current) flushCurrent(current.sectionEndExclusive);
	else pushPreambleIfAny();

	return sections;
}

function previewOneLine(text: string, max = 220): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, max).replace(/"/g, '\\"');
}

function formatNestedSubsections(paras: DocParagraphExcerpt[], sectionExclusiveEnd: number, baseIndent: string): string[] {
	const lines: string[] = [];
	let i = 0;
	while (i < paras.length) {
		const p = paras[i];
		const lvl = outlineLevelFromNamedStyle(p.style);
		if (lvl !== null) {
			let j = i + 1;
			while (j < paras.length) {
				const l2 = outlineLevelFromNamedStyle(paras[j].style);
				if (l2 !== null && l2 <= lvl) break;
				j++;
			}
			const nestedEnd = j < paras.length ? paras[j].startIndex : sectionExclusiveEnd;
			lines.push(`${baseIndent}[${p.style}] "${previewOneLine(p.text)}" — section idx ${p.startIndex}–${nestedEnd}`);
			if (j > i + 1) {
				lines.push(...formatNestedSubsections(paras.slice(i + 1, j), nestedEnd, `${baseIndent}  `));
			}
			i = j;
		} else {
			lines.push(`${baseIndent}[${p.style}] "${previewOneLine(p.text)}" (idx ${p.startIndex}–${p.endIndex})`);
			i++;
		}
	}
	return lines;
}

function formatDocumentStructureString(sections: DocSectionExcerpt[], driveTitle?: string): string {
	const lines: string[] = ['DOCUMENT STRUCTURE:'];
	if (driveTitle?.trim()) lines.push(`Drive filename: "${driveTitle.trim().replace(/"/g, '\\"')}"`);
	for (const s of sections) {
		if (s.headingStyle === 'PREAMBLE') {
			lines.push(`[PREAMBLE] (text before first title/heading) — idx ${s.sectionStartIndex}–${s.sectionEndExclusive}`);
			lines.push(...formatNestedSubsections(s.paragraphs, s.sectionEndExclusive, '  '));
			lines.push('');
			continue;
		}
		lines.push(`[${s.headingStyle}] "${previewOneLine(s.headingText)}" — section idx ${s.sectionStartIndex}–${s.sectionEndExclusive}`);
		if (s.paragraphs.length > 1) {
			lines.push(...formatNestedSubsections(s.paragraphs.slice(1), s.sectionEndExclusive, '  '));
		}
		lines.push('');
	}
	return lines.join('\n').trimEnd();
}

export function getFlatParagraphsFromBody(body: { content?: unknown[] } | undefined): DocParagraphExcerpt[] {
	const flat: DocParagraphExcerpt[] = [];
	collectFlatParagraphs(body?.content, flat);
	return flat;
}

export function extractPlainTextInRange(flat: DocParagraphExcerpt[], startIndex: number, endExclusive: number): string {
	let out = '';
	for (const p of flat) {
		if (p.endIndex <= startIndex || p.startIndex >= endExclusive) continue;
		const rs = Math.max(0, startIndex - p.startIndex);
		const re = Math.min(p.text.length, endExclusive - p.startIndex);
		if (re > rs) out += p.text.slice(rs, re);
	}
	return out;
}

export function extractDocumentContext(body: { content?: unknown[] } | undefined, driveTitle?: string): ExtractedDocumentContext {
	const flat: DocParagraphExcerpt[] = [];
	collectFlatParagraphs(body?.content, flat);
	if (!flat.length) return { contextString: 'DOCUMENT STRUCTURE:\n(empty document body)', sections: [] };
	const sections = buildSectionsFromFlatParagraphs(flat);
	return { contextString: formatDocumentStructureString(sections, driveTitle), sections };
}

export function findSectionDeleteRangeByHeading(sections: DocSectionExcerpt[], sectionHeading: string): DocIndexRange | null {
	const q = sectionHeading.trim().toLowerCase();
	if (!q) return null;
	const candidates = sections.filter((s) => s.headingStyle !== 'PREAMBLE');
	for (const s of candidates) {
		if (s.headingText.toLowerCase().includes(q)) return { startIndex: s.sectionStartIndex, endIndex: s.sectionEndExclusive };
	}
	for (const s of candidates) {
		if (q.includes(s.headingText.toLowerCase().trim())) return { startIndex: s.sectionStartIndex, endIndex: s.sectionEndExclusive };
	}
	return null;
}

/** Docs API index to insert at: before the matched heading, or after the entire section (exclusive end). */
export function findInsertIndexRelativeToSection(
	sections: DocSectionExcerpt[],
	anchorHeading: string,
	placement: 'before' | 'after',
): number | null {
	const q = anchorHeading.trim().toLowerCase();
	if (!q) return null;
	const candidates = sections.filter((s) => s.headingStyle !== 'PREAMBLE');
	let match: DocSectionExcerpt | null = null;
	for (const s of candidates) {
		if (s.headingText.toLowerCase().includes(q)) {
			match = s;
			break;
		}
	}
	if (!match) {
		for (const s of candidates) {
			if (q.includes(s.headingText.toLowerCase().trim())) {
				match = s;
				break;
			}
		}
	}
	if (!match) return null;
	return placement === 'before' ? match.sectionStartIndex : match.sectionEndExclusive;
}
