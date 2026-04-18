import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import { createStyledPresentation, addSlide, editSlide, deleteSlide } from '../services/slidesService.js';
import { getActiveFile, setActiveFile, addToHistory } from '../services/sessionContext.js';
import type { WorkspaceAction } from '../types/actions.js';

const router = Router();

function extractFileId(url: string): string | null {
	const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
	return match?.[1] ?? null;
}

async function executeAction(action: WorkspaceAction, oauthClient: any, apiKey: string | undefined) {
	switch (action.action) {
		case 'create_document': {
			const docs = google.docs({ version: 'v1', auth: oauthClient });
			const title = action.title?.trim();
			const content = action.content_prompt?.trim();
			if (!title || !content) throw new Error('create_document requires title and content_prompt');

			const doc = await docs.documents.create({ requestBody: { title } });
			const documentId = doc.data.documentId;
			if (!documentId) throw new Error('Failed to create document');

			await docs.documents.batchUpdate({
				documentId,
				requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
			});

			return {
				action: 'create_document',
				title,
				url: `https://docs.google.com/document/d/${documentId}/edit`,
				fileType: 'doc',
				summary: `Created Google Doc: ${title}`,
			};
		}

		case 'create_spreadsheet': {
			const sheets = google.sheets({ version: 'v4', auth: oauthClient });
			const title = action.title?.trim();
			const headers = action.headers || [];
			const rows = action.rows || [];
			if (!title || headers.length === 0) throw new Error('create_spreadsheet requires title and headers');

			const toCell = (val: unknown) => {
				if (typeof val === 'number') return { userEnteredValue: { numberValue: val } };
				const str = String(val ?? '');
				if (action.include_formulas && str.startsWith('=')) return { userEnteredValue: { formulaValue: str } };
				return { userEnteredValue: { stringValue: str } };
			};

			const spreadsheet = await sheets.spreadsheets.create({
				requestBody: {
					properties: { title },
					sheets: [{
						data: [{
							startRow: 0, startColumn: 0,
							rowData: [
								{ values: headers.map((h) => toCell(h)) },
								...rows.map((row) => ({ values: row.map((cell) => toCell(cell)) })),
							],
						}],
					}],
				},
			});

			const spreadsheetId = spreadsheet.data.spreadsheetId;
			if (!spreadsheetId) throw new Error('Failed to create spreadsheet');

			return {
				action: 'create_spreadsheet',
				title,
				url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
				fileType: 'sheet',
				summary: `Created Google Sheet: ${title}`,
			};
		}

		case 'create_presentation': {
			const title = action.title?.trim();
			if (!title) throw new Error('create_presentation requires title');
			const prompts = action.slide_prompts?.length ? action.slide_prompts : ['Title slide', 'Key points', 'Next steps'];

			const { url, slideCount } = await createStyledPresentation(title, prompts, oauthClient, apiKey);

			return {
				action: 'create_presentation',
				title,
				url,
				fileType: 'slides',
				summary: `Created "${title}" — ${slideCount} styled slides`,
			};
		}

		case 'create_event': {
			const calendar = google.calendar({ version: 'v3', auth: oauthClient });
			const summary = action.summary?.trim();
			if (!summary || !action.start_time || !action.end_time) throw new Error('create_event requires summary, start_time, end_time');

			const event = await calendar.events.insert({
				calendarId: 'primary',
				requestBody: {
					summary,
					start: { dateTime: new Date(action.start_time).toISOString() },
					end: { dateTime: new Date(action.end_time).toISOString() },
					location: action.location,
					description: action.description,
				},
			});

			return {
				action: 'create_event',
				title: summary,
				url: event.data.htmlLink ?? '',
				fileType: 'calendar',
				summary: `Created calendar event: ${summary}`,
			};
		}

		case 'create_form': {
			const forms = google.forms({ version: 'v1', auth: oauthClient });
			const title = action.title?.trim();
			if (!title || !action.questions?.length) throw new Error('create_form requires title and questions');

			const form = await forms.forms.create({ requestBody: { info: { title } } });
			const formId = form.data.formId;
			if (!formId) throw new Error('Failed to create form');

			return {
				action: 'create_form',
				title,
				url: `https://docs.google.com/forms/d/${formId}/edit`,
				fileType: 'form',
				summary: `Created Google Form: ${title}`,
			};
		}

		case 'create_draft': {
			const gmail = google.gmail({ version: 'v1', auth: oauthClient });
			const to = action.to?.trim();
			const subject = action.subject?.trim();
			const body = action.body_prompt?.trim();
			if (!to || !subject || !body) throw new Error('create_draft requires to, subject, body_prompt');

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
			).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

			const draft = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });

			return {
				action: 'create_draft',
				title: subject,
				url: `https://mail.google.com/mail/#drafts/${draft.data.id}`,
				fileType: 'gmail',
				summary: `Draft email to ${to}: ${subject}`,
			};
		}

		case 'send_email': {
			const gmail = google.gmail({ version: 'v1', auth: oauthClient });
			const to = action.to?.trim();
			const subject = action.subject?.trim();
			const body = action.body_prompt?.trim();
			if (!to || !subject || !body) throw new Error('send_email requires to, subject, body_prompt');

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
			).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

			await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

			return {
				action: 'send_email',
				title: subject,
				url: `https://mail.google.com/mail/#search/${encodeURIComponent(to)}`,
				fileType: 'gmail',
				summary: `Email sent to ${to}: ${subject}`,
			};
		}

		case 'list_files': {
			const drive = google.drive({ version: 'v3', auth: oauthClient });
			const result = await drive.files.list({
				q: action.query ? `trashed = false and (name contains '${action.query}')` : 'trashed = false',
				pageSize: action.limit ?? 10,
				fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
				orderBy: 'modifiedTime desc',
			});

			return {
				action: 'list_files',
				title: 'Drive files',
				fileType: 'list',
				items: result.data.files ?? [],
				summary: `Found ${(result.data.files ?? []).length} files`,
			};
		}

		case 'search_drive': {
			const drive = google.drive({ version: 'v3', auth: oauthClient });
			const query = action.query?.trim();
			if (!query) throw new Error('search_drive requires query');

			const result = await drive.files.list({
				q: `trashed = false and (name contains '${query}' or fullText contains '${query}')`,
				pageSize: 20,
				fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
			});

			return {
				action: 'search_drive',
				title: `Search results for ${query}`,
				fileType: 'list',
				items: result.data.files ?? [],
				summary: `Found ${(result.data.files ?? []).length} files`,
			};
		}

		case 'clarify':
			return {
				action: 'clarify',
				title: 'Clarification needed',
				fileType: 'system',
				summary: action.question,
			};

		case 'edit_presentation': {
			const fileId = action.fileId;
			if (!fileId) throw new Error('No active presentation to edit. Create one first.');

			const url = `https://docs.google.com/presentation/d/${fileId}/edit`;

			if (action.operation === 'add_slide') {
				const { title } = await addSlide(fileId, action.slide_prompt ?? 'New slide', oauthClient, apiKey);
				return { action: 'edit_presentation', title, url, fileType: 'slides', summary: `Added slide: "${title}"` };
			}

			if (action.operation === 'edit_slide') {
				const idx = action.slide_index ?? 0;
				await editSlide(fileId, idx, { title: action.title, body: action.body }, oauthClient);
				return { action: 'edit_presentation', title: action.title ?? `Slide ${idx + 1}`, url, fileType: 'slides', summary: `Updated slide ${idx + 1}` };
			}

			if (action.operation === 'delete_slide') {
				const idx = action.slide_index ?? 0;
				await deleteSlide(fileId, idx, oauthClient);
				return { action: 'edit_presentation', title: `Slide ${idx + 1} deleted`, url, fileType: 'slides', summary: `Deleted slide ${idx + 1}` };
			}

			throw new Error(`Unknown edit_presentation operation: ${action.operation}`);
		}

		case 'edit_document': {
			const fileId = action.fileId;
			if (!fileId) throw new Error('No active document to edit. Create one first.');

			const docs = google.docs({ version: 'v1', auth: oauthClient });
			const heading = action.heading?.trim();
			const content = action.content_prompt?.trim();
			if (!heading || !content) throw new Error('edit_document requires heading and content_prompt');

			const text = `\n\n${heading}\n${content}`;
			await docs.documents.batchUpdate({
				documentId: fileId,
				requestBody: { requests: [{ insertText: { endOfSegmentLocation: {}, text } }] },
			});

			return {
				action: 'edit_document',
				title: heading,
				url: `https://docs.google.com/document/d/${fileId}/edit`,
				fileType: 'doc',
				summary: `Added section "${heading}"`,
			};
		}

		case 'edit_spreadsheet': {
			const fileId = action.fileId;
			if (!fileId) throw new Error('No active spreadsheet to edit. Create one first.');

			const sheets = google.sheets({ version: 'v4', auth: oauthClient });
			const url = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;

			if (action.operation === 'add_row') {
				const row = action.row ?? [];
				await sheets.spreadsheets.values.append({
					spreadsheetId: fileId,
					range: 'Sheet1',
					valueInputOption: 'USER_ENTERED',
					requestBody: { values: [row] },
				});
				return { action: 'edit_spreadsheet', title: 'Row added', url, fileType: 'sheet', summary: `Added row: ${row.join(', ')}` };
			}

			if (action.operation === 'add_column') {
				const header = action.header?.trim() ?? 'New Column';
				const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId });
				const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
				await sheets.spreadsheets.batchUpdate({
					spreadsheetId: fileId,
					requestBody: { requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: 1 } }] },
				});
				return { action: 'edit_spreadsheet', title: header, url, fileType: 'sheet', summary: `Added column "${header}"` };
			}

			throw new Error(`Unknown edit_spreadsheet operation: ${action.operation}`);
		}
	}
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
	try {
		const { command } = req.body as { command?: string };
		if (!command || typeof command !== 'string' || !command.trim()) {
			return res.status(400).json({ error: 'command is required' });
		}

		const sessionId = (req.session as any).id;
		const activeFile = getActiveFile(sessionId);

		const parsed = await parseCommandWithGemini(command.trim(), { activeFile });
		const action = parsed.action;

		// Inject fileId from session for edit actions
		if (
			(action.action === 'edit_presentation' ||
				action.action === 'edit_document' ||
				action.action === 'edit_spreadsheet') &&
			!action.fileId
		) {
			if (!activeFile) {
				return res.status(400).json({ error: 'No active file to edit. Create a file first.' });
			}
			(action as any).fileId = activeFile.id;
		}

		const result = await executeAction(action, req.oauthClient, process.env.GEMINI_API_KEY);

		// Track active file after creation
		if (result && 'url' in result && result.url) {
			const fileId = extractFileId(result.url);
			if (fileId) {
				if (action.action === 'create_presentation') {
					setActiveFile(sessionId, { id: fileId, type: 'presentation', title: result.title ?? '' });
				} else if (action.action === 'create_document') {
					setActiveFile(sessionId, { id: fileId, type: 'document', title: result.title ?? '' });
				} else if (action.action === 'create_spreadsheet') {
					setActiveFile(sessionId, { id: fileId, type: 'spreadsheet', title: result.title ?? '' });
				}
			}
		}

		addToHistory(sessionId, `${command} → ${result?.summary ?? ''}`);

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
