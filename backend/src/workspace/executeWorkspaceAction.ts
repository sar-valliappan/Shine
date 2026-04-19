import { google } from 'googleapis';
import type { WorkspaceAction } from '../types/actions.js';
import { executeDocumentAction } from './documents.js';

import type { ParseRouteResult } from './types.js';

export async function executeWorkspaceAction(
	action: WorkspaceAction,
	oauthClient: unknown,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	switch (action.action) {
		case 'create_document':
		case 'edit_document':
			return executeDocumentAction(action, oauthClient, apiKey);

		case 'create_presentation':
		case 'edit_presentation':
			throw new Error('Slides actions should be routed through handleSlidesCommand directly');

		case 'create_event': {
			const calendar = google.calendar({ version: 'v3', auth: oauthClient as any });
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
				url: event.data.htmlLink ?? '',
				fileType: 'calendar',
				summary: `Created calendar event: ${summary}`,
			};
		}

		case 'create_form': {
			const forms = google.forms({ version: 'v1', auth: oauthClient as any });
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
			const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
			const to = action.to?.trim();
			const subject = action.subject?.trim();
			const body = action.body_prompt?.trim();
			if (!to || !subject || !body) throw new Error('create_draft requires to, subject, body_prompt');

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
			)
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/g, '');

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
			const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
			const to = action.to?.trim();
			const subject = action.subject?.trim();
			const body = action.body_prompt?.trim();
			if (!to || !subject || !body) throw new Error('send_email requires to, subject, body_prompt');

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
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
			const drive = google.drive({ version: 'v3', auth: oauthClient as any });
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
			const drive = google.drive({ version: 'v3', auth: oauthClient as any });
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

		default:
			throw new Error(`Unhandled action: ${(action as WorkspaceAction).action}`);
	}
}
