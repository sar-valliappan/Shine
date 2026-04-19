import { google } from 'googleapis';
import type { EditDocumentOperation, WorkspaceAction } from '../types/actions.js';
import {
	buildDocRequests,
	collectTableCellInsertionIndices,
	generateDocumentContent,
	shiftDocRequestsToEnd,
} from '../services/docsService.js';
import {
	extractDocumentContext,
	extractPlainTextInRange,
	findInsertIndexRelativeToSection,
	findSectionDeleteRangeByHeading,
	findTextRangeInBody,
	getBodyClearRange,
	getBodyEndInsertIndex,
	getFlatParagraphsFromBody,
} from '../services/googleDocsBodyHelpers.js';
import { parseDocsCommandWithContext } from '../services/gemini.js';
import { getActiveWorkspace, type ActiveWorkspace } from './activeSession.js';
import { peekDocsUndo, popDocsUndo, pushDocsUndo } from './docsUndoStack.js';
import type { ParseRouteResult } from './types.js';

export async function handleDocsCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
	sessionId?: string,
): Promise<ParseRouteResult> {
	const workspace = sessionId ? getActiveWorkspace(sessionId) : active;
	const parsed = await parseDocsCommandWithContext(command, workspace, oauthClient);
	const action = parsed.action;

	// Gemini sometimes returns `clarify` or another workspace action; never cast those into editDocument
	// (that produced the misleading "No active document to edit" error).
	if (action.action === 'clarify') {
		return {
			action: 'clarify',
			title: 'Clarification needed',
			fileType: 'system',
			summary: action.question,
		};
	}
	if (action.action !== 'create_document' && action.action !== 'edit_document') {
		return {
			action: action.action,
			title: 'Not a document edit',
			fileType: 'system',
			summary: `That command resolved to "${action.action}" instead of editing the open Google Doc. Rephrase as a doc change (e.g. delete a section, add a chapter, bold text).`,
		};
	}

	if (action.action === 'edit_document') {
		normalizeEditDocumentOperation(action);
		if (!action.fileId && workspace.document) action.fileId = workspace.document.id;
	}
	return executeDocumentAction(
		action as Extract<WorkspaceAction, { action: 'create_document' | 'edit_document' }>,
		oauthClient,
		apiKey,
		sessionId,
	);
}

type DocAction = Extract<WorkspaceAction, { action: 'create_document' | 'edit_document' }>;

const EDIT_DOC_OPS = new Set<EditDocumentOperation>([
	'add_section',
	'insert_section',
	'append',
	'replace_text',
	'delete_text',
	'insert_table',
	'style_text',
	'set_font',
	'insert_page_break',
	'delete_section',
	'rename_document',
	'undo',
	'rewrite_document',
]);

const EDIT_DOC_OP_ALIASES: Record<string, EditDocumentOperation> = {
	rewrite: 'rewrite_document',
	regenerate: 'rewrite_document',
	regenerate_document: 'rewrite_document',
	replace_body: 'rewrite_document',
	replace_document: 'rewrite_document',
	rebuild_document: 'rewrite_document',
	change_font: 'set_font',
	update_font: 'set_font',
	font: 'set_font',
	font_family: 'set_font',
	setfont: 'set_font',
	find_and_replace: 'replace_text',
	find_replace: 'replace_text',
	remove_section: 'delete_section',
	delete_chapter: 'delete_section',
	remove_chapter: 'delete_section',
};

function normalizeEditDocumentOperation(action: Extract<WorkspaceAction, { action: 'edit_document' }>): void {
	const raw = (action as { operation?: unknown }).operation;
	const key = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_') : '';
	if (!key) return;
	if (EDIT_DOC_OP_ALIASES[key]) {
		(action as { operation: EditDocumentOperation }).operation = EDIT_DOC_OP_ALIASES[key];
		return;
	}
	if (EDIT_DOC_OPS.has(key as EditDocumentOperation)) {
		(action as { operation: EditDocumentOperation }).operation = key as EditDocumentOperation;
		return;
	}
	const a = action as { content_prompt?: string; font_family?: string };
	if (
		(key.includes('rewrite') || key.includes('regenerate') || key.includes('rebuild') ||
			key.includes('replace_whole') || key.includes('replace_entire') || key.includes('full_document')) &&
		typeof a.content_prompt === 'string' && a.content_prompt.trim()
	) {
		(action as { operation: EditDocumentOperation }).operation = 'rewrite_document';
		return;
	}
	if ((key.includes('font') || key.includes('typeface')) && typeof a.font_family === 'string' && a.font_family.trim()) {
		(action as { operation: EditDocumentOperation }).operation = 'set_font';
	}
}

export async function executeDocumentAction(
	action: DocAction,
	oauthClient: unknown,
	apiKey: string | undefined,
	sessionId?: string,
): Promise<ParseRouteResult> {
	if (action.action === 'create_document') return createDocument(action, oauthClient, apiKey);
	return editDocument(action, oauthClient, apiKey, sessionId);
}

async function createDocument(
	action: Extract<WorkspaceAction, { action: 'create_document' }>,
	oauthClient: unknown,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const docs = google.docs({ version: 'v1', auth: oauthClient as any });
	const title = action.title?.trim();
	const sections = action.sections;
	const contentPrompt =
		action.content_prompt?.trim() ||
		(sections?.length ? `Write a detailed document covering these sections: ${sections.join(', ')}` : '') ||
		`Write a comprehensive document about: ${title}`;
	if (!title) throw new Error('create_document requires title');

	const markdown = apiKey
		? await generateDocumentContent(title, contentPrompt, apiKey)
		: `# ${title}\n\n${contentPrompt}`;

	const doc = await docs.documents.create({ requestBody: { title } });
	const documentId = doc.data.documentId;
	if (!documentId) throw new Error('Failed to create document');

	const requests = buildDocRequests(markdown);
	if (requests.length > 0) {
		await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
	}

	return {
		action: 'create_document',
		title,
		documentTitle: title,
		url: `https://docs.google.com/document/d/${documentId}/edit`,
		fileType: 'doc',
		summary: `Created Google Doc: ${title}`,
	};
}

async function editDocument(
	action: Extract<WorkspaceAction, { action: 'edit_document' }>,
	oauthClient: unknown,
	apiKey: string | undefined,
	sessionId?: string,
): Promise<ParseRouteResult> {
	const fileId = action.fileId;
	if (!fileId) throw new Error('No active document to edit. Create one first.');

	const auth = oauthClient as any;
	const docs = google.docs({ version: 'v1', auth });
	const drive = google.drive({ version: 'v3', auth });
	const url = `https://docs.google.com/document/d/${fileId}/edit`;

	let documentDisplayTitle: string | undefined;
	try {
		documentDisplayTitle = (await drive.files.get({ fileId, fields: 'name' })).data.name ?? undefined;
	} catch { /* non-fatal */ }

	const docResult = (partial: { title?: string; summary: string; activeDocumentTitle?: string }): ParseRouteResult => ({
		action: 'edit_document',
		fileType: 'doc',
		url,
		documentTitle: documentDisplayTitle,
		...partial,
	});

	switch (action.operation) {
		case 'undo': {
			const batch = peekDocsUndo(sessionId);
			if (!batch) throw new Error('Nothing to undo for this session.');
			if (batch.documentId !== fileId) {
				throw new Error('The last recorded edit was on a different document.');
			}
			popDocsUndo(sessionId);
			if (batch.kind === 'drive_rename') {
				await drive.files.update({ fileId, requestBody: { name: batch.previousTitle } });
				return docResult({ title: 'Undo', summary: `Restored document name to "${batch.previousTitle}"` });
			}
			await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: batch.requests as any[] } });
			return docResult({ title: 'Undo', summary: 'Undid the last document edit in this session' });
		}

		case 'rename_document': {
			const newTitle = action.new_title?.trim();
			if (!newTitle) throw new Error('rename_document requires new_title');
			const prev = (await drive.files.get({ fileId, fields: 'name' })).data.name ?? '';
			await drive.files.update({ fileId, requestBody: { name: newTitle } });
			pushDocsUndo(sessionId, { kind: 'drive_rename', documentId: fileId, previousTitle: prev });
			return docResult({ title: newTitle, activeDocumentTitle: newTitle, summary: `Renamed document to "${newTitle}"` });
		}

		case 'delete_section': {
			const heading = action.section_heading?.trim();
			if (!heading) throw new Error('delete_section requires section_heading');
			const meta = await docs.documents.get({ documentId: fileId });
			const { sections } = extractDocumentContext(meta.data.body as { content?: unknown[] });
			const range = findSectionDeleteRangeByHeading(sections, heading);
			if (!range) throw new Error(`Could not find a section called "${heading}" in the document`);
			const flat = getFlatParagraphsFromBody(meta.data.body as { content?: unknown[] });
			const removed = extractPlainTextInRange(flat, range.startIndex, range.endIndex);
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ deleteContentRange: { range } }] },
			});
			pushDocsUndo(sessionId, {
				kind: 'docs_batch',
				documentId: fileId,
				requests: [{ insertText: { location: { index: range.startIndex }, text: removed } }],
			});
			return docResult({ title: 'Section removed', summary: `Deleted section "${heading.slice(0, 80)}${heading.length > 80 ? '…' : ''}"` });
		}

		case 'insert_page_break': {
			const meta = await docs.documents.get({ documentId: fileId });
			const endIndex = getBodyEndInsertIndex(meta.data.body?.content as unknown[] | undefined);
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ insertPageBreak: { location: { index: endIndex } } }] },
			});
			return docResult({ title: 'Page break', summary: 'Inserted a page break at the end of the document' });
		}

		case 'set_font': {
			const family = action.font_family?.trim();
			const fontSize = action.font_size;
			if (!family && !(typeof fontSize === 'number' && fontSize > 0)) {
				throw new Error('set_font requires font_family and/or a positive font_size');
			}
			const meta = await docs.documents.get({ documentId: fileId });
			const content = meta.data.body?.content as unknown[] | undefined;
			const find = action.find_text?.trim();
			let range: { startIndex: number; endIndex: number } | null = null;
			if (find) {
				range = findTextRangeInBody(content, find, { matchCase: action.match_case ?? false });
				if (!range) throw new Error(`Could not find "${find}" in the document`);
			} else {
				range = getBodyClearRange(content);
				if (!range) throw new Error('Could not determine document body range for font change');
			}
			const textStyle: Record<string, unknown> = {};
			const fields: string[] = [];
			if (family) { textStyle.weightedFontFamily = { fontFamily: family, weight: 400 }; fields.push('weightedFontFamily'); }
			if (typeof fontSize === 'number' && fontSize > 0) { textStyle.fontSize = { magnitude: fontSize, unit: 'PT' }; fields.push('fontSize'); }
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ updateTextStyle: { range, textStyle, fields: fields.join(',') } }] },
			});
			const scope = find ? `first match of "${find.slice(0, 50)}${find.length > 50 ? '…' : ''}"` : 'entire document';
			return docResult({
				title: 'Font updated',
				summary: family
					? `Set font to ${family}${typeof fontSize === 'number' && fontSize > 0 ? `, ${fontSize}pt` : ''} (${scope})`
					: `Set font size to ${fontSize}pt (${scope})`,
			});
		}

		case 'style_text': {
			const find = action.find_text?.trim();
			if (!find) throw new Error('style_text requires find_text');
			const styleBits: Array<{ key: string; val: boolean; field: string }> = [];
			if (typeof action.bold === 'boolean') styleBits.push({ key: 'bold', val: action.bold, field: 'bold' });
			if (typeof action.italic === 'boolean') styleBits.push({ key: 'italic', val: action.italic, field: 'italic' });
			if (typeof action.underline === 'boolean') styleBits.push({ key: 'underline', val: action.underline, field: 'underline' });
			if (typeof action.strikethrough === 'boolean') styleBits.push({ key: 'strikethrough', val: action.strikethrough, field: 'strikethrough' });
			const fontFamily = action.font_family?.trim();
			const fontSize = action.font_size;
			const hasFont = !!fontFamily || (typeof fontSize === 'number' && fontSize > 0);
			if (!styleBits.length && !hasFont) {
				throw new Error('style_text requires at least one of bold, italic, underline, strikethrough, font_family, or font_size');
			}
			const meta = await docs.documents.get({ documentId: fileId });
			const range = findTextRangeInBody(meta.data.body?.content as unknown[] | undefined, find, { matchCase: action.match_case ?? false });
			if (!range) throw new Error(`Could not find "${find}" in the document`);
			const textStyle: Record<string, unknown> = {};
			const fields: string[] = [];
			for (const b of styleBits) { textStyle[b.key] = b.val; fields.push(b.field); }
			if (fontFamily) { textStyle.weightedFontFamily = { fontFamily: fontFamily, weight: 400 }; fields.push('weightedFontFamily'); }
			if (typeof fontSize === 'number' && fontSize > 0) { textStyle.fontSize = { magnitude: fontSize, unit: 'PT' }; fields.push('fontSize'); }
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ updateTextStyle: { range, textStyle, fields: fields.join(',') } }] },
			});
			return docResult({
				title: 'Text styled',
				summary: `Updated (${fields.join(', ')}) on first match of "${find.slice(0, 60)}${find.length > 60 ? '…' : ''}"`,
			});
		}

		case 'rewrite_document': {
			const contentPrompt = action.content_prompt?.trim();
			if (!contentPrompt) throw new Error('rewrite_document requires content_prompt');
			const meta = await docs.documents.get({ documentId: fileId });
			const bodyContent = meta.data.body?.content as unknown[] | undefined;
			const clearRange = getBodyClearRange(bodyContent);
			if (!clearRange) throw new Error('Could not determine document body to replace');
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ deleteContentRange: { range: clearRange } }] },
			});
			const driveName = documentDisplayTitle ?? 'Document';
			const markdown = apiKey ? await generateDocumentContent(driveName, contentPrompt, apiKey) : `# ${driveName}\n\n${contentPrompt}`;
			const built = buildDocRequests(markdown);
			if (built.length > 0) {
				await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: built } });
			}
			return docResult({ title: 'Document rewritten', summary: 'Replaced the document body with newly generated content' });
		}

		case 'replace_text': {
			const find = action.find_text?.trim();
			if (!find) throw new Error('replace_text requires find_text');
			const replaceWith = action.replace_with ?? '';
			const mc = action.match_case ?? false;
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ replaceAllText: { containsText: { text: find, matchCase: mc }, replaceText: replaceWith } }] },
			});
			pushDocsUndo(sessionId, {
				kind: 'docs_batch',
				documentId: fileId,
				requests: [{ replaceAllText: { containsText: { text: replaceWith, matchCase: mc }, replaceText: find } }],
			});
			return docResult({
				title: 'Text replaced',
				summary: replaceWith.length
					? `Replaced matches of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"`
					: `Cleared matches of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"`,
			});
		}

		case 'delete_text': {
			const find = action.find_text?.trim();
			if (!find) throw new Error('delete_text requires find_text');
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ replaceAllText: { containsText: { text: find, matchCase: action.match_case ?? false }, replaceText: '' } }] },
			});
			return docResult({ title: 'Text removed', summary: `Removed occurrences of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"` });
		}

		case 'insert_table': {
			const headers = action.table_headers ?? [];
			const data = action.table_data ?? [];
			const maxDataCols = data.length ? Math.max(...data.map((r) => r.length)) : 0;
			const colsFromData = Math.max(headers.length, maxDataCols, 0);
			const rowCount = Math.max(2, action.table_rows ?? (headers.length || data.length ? 1 + data.length : 3));
			const columnCount = Math.max(2, action.table_columns ?? (colsFromData || 3));

			const meta = await docs.documents.get({ documentId: fileId });
			const endIndex = (meta.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ insertTable: { rows: rowCount, columns: columnCount, location: { index: endIndex } } }] },
			});

			const flat: string[] = [];
			for (let r = 0; r < rowCount; r++) {
				for (let c = 0; c < columnCount; c++) {
					if (r === 0 && headers.length) flat.push(String(headers[c] ?? ''));
					else if (r > 0 && data[r - 1]) flat.push(String(data[r - 1][c] ?? ''));
					else flat.push('');
				}
			}

			const refreshed = await docs.documents.get({ documentId: fileId });
			const cellIndices = collectTableCellInsertionIndices(refreshed.data.body as any);
			if (cellIndices && flat.length && cellIndices.length === flat.length) {
				const pairs = cellIndices.map((idx, i) => ({ idx, text: flat[i] ?? '' }));
				pairs.sort((a, b) => b.idx - a.idx);
				const inserts = pairs.map((p) => ({ insertText: { location: { index: p.idx }, text: p.text } }));
				if (inserts.length) await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: inserts } });
			}

			return docResult({ title: 'Table inserted', summary: `Inserted a ${rowCount}×${columnCount} table${headers.length ? ' with headers' : ''}` });
		}

		case 'append':
		case 'add_section':
		case 'insert_section': {
			const contentPrompt = action.content_prompt?.trim();
			if (!contentPrompt) throw new Error('edit_document (append/add_section/insert_section) requires content_prompt');
			const heading = action.heading?.trim();
			const generated = apiKey
				? await generateDocumentContent(heading ?? 'New Section', contentPrompt, apiKey)
				: `## ${heading ?? 'New Section'}\n\n${contentPrompt}`;
			const built = buildDocRequests(generated);
			if (built.length > 0) {
				const doc = await docs.documents.get({ documentId: fileId });
				const body = doc.data.body as { content?: unknown[] };
				let insertAt = (body.content?.at(-1)?.endIndex ?? 2) - 1;

				const anchor = action.section_anchor?.trim();
				if (action.operation !== 'append' && anchor) {
					const placement = action.section_placement === 'before' ? 'before' : 'after';
					const { sections } = extractDocumentContext(body);
					const resolved = findInsertIndexRelativeToSection(sections, anchor, placement);
					if (resolved == null) {
						throw new Error(
							`Could not find a section heading matching "${anchor}" to insert ${placement}. Check the DOCUMENT STRUCTURE headings.`,
						);
					}
					insertAt = resolved;
				}

				const shifted = shiftDocRequestsToEnd(built, insertAt);
				await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: shifted } });
			}
			const where =
				action.operation !== 'append' && action.section_anchor?.trim()
					? ` (${action.section_placement === 'before' ? 'before' : 'after'} "${action.section_anchor.trim()}")`
					: '';
			return docResult({
				title: heading ?? 'Section added',
				summary: `Added section "${heading ?? 'new content'}"${where}`,
			});
		}

		default: {
			const op = (action as { operation?: string }).operation;
			throw new Error(`Unsupported edit_document operation: ${String(op ?? 'unknown')}. Supported: ${[...EDIT_DOC_OPS].join(', ')}`);
		}
	}
}
