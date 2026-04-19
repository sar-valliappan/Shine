import { google } from 'googleapis';
import type { WorkspaceAction } from '../types/actions.js';
import {
	buildDocRequests,
	collectTableCellInsertionIndices,
	generateDocumentContent,
	shiftDocRequestsToEnd,
} from '../services/docsService.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import type { ActiveWorkspace } from './activeSession.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ParseRouteResult } from './types.js';

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Docs-specific Gemini call
// that receives the user command + full Docs API command list and returns
// the exact sequence of API operations to run.
export async function handleDocsCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	const action = parsed.action;
	if (action.action === 'share_file') {
		if (!action.fileId && active.document) {
			action.fileId = active.document.id;
			action.fileType = 'doc';
			action.title = active.document.title;
		}
		return executeWorkspaceAction(action, oauthClient, apiKey);
	}
	if (action.action === 'edit_document' && !action.fileId && active.document) {
		action.fileId = active.document.id;
	}
	return executeDocumentAction(action as Extract<WorkspaceAction, { action: 'create_document' | 'edit_document' }>, oauthClient, apiKey);
}

type DocAction = Extract<WorkspaceAction, { action: 'create_document' | 'edit_document' }>;

export async function executeDocumentAction(
	action: DocAction,
	oauthClient: unknown,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	if (action.action === 'create_document') {
		return createDocument(action, oauthClient, apiKey);
	}
	return editDocument(action, oauthClient, apiKey);
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
		url: `https://docs.google.com/document/d/${documentId}/edit`,
		fileType: 'doc',
		summary: `Created Google Doc: ${title}`,
	};
}

async function editDocument(
	action: Extract<WorkspaceAction, { action: 'edit_document' }>,
	oauthClient: unknown,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const fileId = action.fileId;
	if (!fileId) throw new Error('No active document to edit. Create one first.');

	const docs = google.docs({ version: 'v1', auth: oauthClient as any });
	const url = `https://docs.google.com/document/d/${fileId}/edit`;

	switch (action.operation) {
		case 'replace_text': {
			const find = action.find_text?.trim();
			if (!find) throw new Error('replace_text requires find_text');
			const replaceWith = action.replace_with ?? '';
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: {
					requests: [
						{
							replaceAllText: {
								containsText: { text: find, matchCase: action.match_case ?? false },
								replaceText: replaceWith,
							},
						},
					],
				},
			});
			return {
				action: 'edit_document',
				title: 'Text replaced',
				url,
				fileType: 'doc',
				summary: replaceWith.length
					? `Replaced matches of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"`
					: `Cleared matches of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"`,
			};
		}
		case 'delete_text': {
			const find = action.find_text?.trim();
			if (!find) throw new Error('delete_text requires find_text');
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: {
					requests: [
						{
							replaceAllText: {
								containsText: { text: find, matchCase: action.match_case ?? false },
								replaceText: '',
							},
						},
					],
				},
			});
			return {
				action: 'edit_document',
				title: 'Text removed',
				url,
				fileType: 'doc',
				summary: `Removed occurrences of "${find.slice(0, 80)}${find.length > 80 ? '…' : ''}"`,
			};
		}
		case 'insert_table': {
			const headers = action.table_headers ?? [];
			const data = action.table_data ?? [];
			const maxDataCols = data.length ? Math.max(...data.map((r) => r.length)) : 0;
			const colsFromData = Math.max(headers.length, maxDataCols, 0);
			const rowCount = Math.max(
				2,
				action.table_rows ?? (headers.length || data.length ? 1 + data.length : 3),
			);
			const columnCount = Math.max(2, action.table_columns ?? (colsFromData || 3));

			const meta = await docs.documents.get({ documentId: fileId });
			const endIndex = (meta.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;

			const requests: any[] = [
				{
					insertTable: {
						rows: rowCount,
						columns: columnCount,
						location: { index: endIndex },
					},
				},
			];
			await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });

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
				const inserts = pairs.map((p) => ({
					insertText: { location: { index: p.idx }, text: p.text },
				}));
				if (inserts.length) {
					await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: inserts } });
				}
			}

			return {
				action: 'edit_document',
				title: 'Table inserted',
				url,
				fileType: 'doc',
				summary: `Inserted a ${rowCount}×${columnCount} table${headers.length ? ' with headers' : ''}`,
			};
		}
		case 'append':
		case 'add_section': {
			const contentPrompt = action.content_prompt?.trim();
			if (!contentPrompt) throw new Error('edit_document (append/add_section) requires content_prompt');

			const heading = action.heading?.trim();
			const generated = apiKey
				? await generateDocumentContent(heading ?? 'New Section', contentPrompt, apiKey)
				: `## ${heading ?? 'New Section'}\n\n${contentPrompt}`;

			const built = buildDocRequests(generated);
			if (built.length > 0) {
				const doc = await docs.documents.get({ documentId: fileId });
				const endIndex = (doc.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
				const shifted = shiftDocRequestsToEnd(built, endIndex);
				await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: shifted } });
			}

			return {
				action: 'edit_document',
				title: heading ?? 'Section added',
				url,
				fileType: 'doc',
				summary: `Added section "${heading ?? 'new content'}" to document`,
			};
		}
	}
}
