import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import { generateDocumentContent, buildDocRequests } from '../services/docsService.js';
import type { WorkspaceAction } from '../types/actions.js';

// In-memory session store: tracks the last document the user worked on
const activeDocStore = new Map<string, { id: string; title: string }>();

function extractFileId(url: string): string | null {
	return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

const router = Router();

async function executeAction(action: WorkspaceAction, oauthClient: any, apiKey: string | undefined) {
	switch (action.action) {
		case 'create_document': {
			const docs = google.docs({ version: 'v1', auth: oauthClient });
			const title = action.title?.trim();
			const sections = (action as any).sections as string[] | undefined;
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

		case 'create_spreadsheet': {
			const sheets = google.sheets({ version: 'v4', auth: oauthClient });
			const title = action.title?.trim();
			const headers = action.headers || [];
			const rows = action.rows || [];
			if (!title || headers.length === 0) {
				throw new Error('create_spreadsheet requires title and headers');
			}

			const toCell = (val: unknown) => {
				if (typeof val === 'number') return { userEnteredValue: { numberValue: val } };
				const str = String(val ?? '');
				if (action.include_formulas && str.startsWith('=')) {
					return { userEnteredValue: { formulaValue: str } };
				}
				return { userEnteredValue: { stringValue: str } };
			};

			const spreadsheet = await sheets.spreadsheets.create({
				requestBody: {
					properties: { title },
					sheets: [
						{
							data: [
								{
									startRow: 0,
									startColumn: 0,
									rowData: [
										{ values: headers.map((h) => toCell(h)) },
										...rows.map((row) => ({ values: row.map((cell) => toCell(cell)) })),
									],
								},
							],
						},
					],
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
			const slides = google.slides({ version: 'v1', auth: oauthClient });
			const title = action.title?.trim();
			if (!title) throw new Error('create_presentation requires title');

			const created = await slides.presentations.create({ requestBody: { title } });
			const presentationId = created.data.presentationId;
			if (!presentationId) throw new Error('Failed to create presentation');

			return {
				action: 'create_presentation',
				title,
				url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
				fileType: 'slides',
				summary: `Created Google Slides presentation: ${title}`,
			};
		}

		case 'create_event': {
			const calendar = google.calendar({ version: 'v3', auth: oauthClient });
			const summary = action.summary?.trim();
			if (!summary || !action.start_time || !action.end_time) {
				throw new Error('create_event requires summary, start_time, end_time');
			}

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
				url: event.data.htmlLink,
				fileType: 'calendar',
				summary: `Created calendar event: ${summary}`,
			};
		}

		case 'create_form': {
			const forms = google.forms({ version: 'v1', auth: oauthClient });
			const title = action.title?.trim();
			if (!title || !action.questions?.length) {
				throw new Error('create_form requires title and questions');
			}

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
			if (!to || !subject || !body) {
				throw new Error('create_draft requires to, subject, body_prompt');
			}

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n')
			)
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/g, '');

			const draft = await gmail.users.drafts.create({
				userId: 'me',
				requestBody: { message: { raw } },
			});

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
			if (!to || !subject || !body) {
				throw new Error('send_email requires to, subject, body_prompt');
			}

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n')
			)
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/g, '');

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

		case 'edit_document': {
			const fileId = action.fileId;
			if (!fileId) throw new Error('No active document to edit. Create one first.');

			const docs = google.docs({ version: 'v1', auth: oauthClient });
			const contentPrompt = action.content_prompt?.trim();
			if (!contentPrompt) throw new Error('edit_document requires content_prompt');

			const heading = action.heading?.trim();
			const generated = apiKey
				? await generateDocumentContent(heading ?? 'New Section', contentPrompt, apiKey)
				: `## ${heading ?? 'New Section'}\n\n${contentPrompt}`;

			const requests = buildDocRequests(generated);
			if (requests.length > 0) {
				// Shift all insert positions to end of document
				const doc = await docs.documents.get({ documentId: fileId });
				const endIndex = (doc.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
				const shifted = requests.map((r: any) => {
					if (r.insertText?.location?.index !== undefined) {
						return { ...r, insertText: { ...r.insertText, location: { index: endIndex } } };
					}
					if (r.updateParagraphStyle?.range) {
						const offset = endIndex - 1;
						return { ...r, updateParagraphStyle: { ...r.updateParagraphStyle, range: { startIndex: r.updateParagraphStyle.range.startIndex + offset, endIndex: r.updateParagraphStyle.range.endIndex + offset } } };
					}
					if (r.updateTextStyle?.range) {
						const offset = endIndex - 1;
						return { ...r, updateTextStyle: { ...r.updateTextStyle, range: { startIndex: r.updateTextStyle.range.startIndex + offset, endIndex: r.updateTextStyle.range.endIndex + offset } } };
					}
					if (r.createParagraphBullets?.range) {
						const offset = endIndex - 1;
						return { ...r, createParagraphBullets: { ...r.createParagraphBullets, range: { startIndex: r.createParagraphBullets.range.startIndex + offset, endIndex: r.createParagraphBullets.range.endIndex + offset } } };
					}
					return r;
				});
				await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: shifted } });
			}

			return {
				action: 'edit_document',
				title: heading ?? 'Section added',
				url: `https://docs.google.com/document/d/${fileId}/edit`,
				fileType: 'doc',
				summary: `Added section "${heading ?? 'new content'}" to document`,
			};
		}

		case 'clarify':
			return {
				action: 'clarify',
				title: 'Clarification needed',
				fileType: 'system',
				summary: action.question,
			};
	}
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
	try {
		const { command } = req.body as { command?: string };
		if (!command || typeof command !== 'string' || !command.trim()) {
			return res.status(400).json({ error: 'command is required' });
		}

		const sessionId = (req.session as any).id;
		const activeDoc = activeDocStore.get(sessionId);

		const parsed = await parseCommandWithGemini(command.trim(), activeDoc ?? null);

		// Inject fileId from session for edit actions
		if (parsed.action.action === 'edit_document' && !parsed.action.fileId) {
			if (!activeDoc) return res.status(400).json({ error: 'No active document. Create a document first.' });
			(parsed.action as any).fileId = activeDoc.id;
		}

		const result = await executeAction(parsed.action, req.oauthClient, process.env.GEMINI_API_KEY);

		// Track the doc after creation
		if (result && 'url' in result && result.url && parsed.action.action === 'create_document') {
			const fileId = extractFileId(result.url as string);
			if (fileId) activeDocStore.set(sessionId, { id: fileId, title: result.title as string ?? '' });
		}

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
