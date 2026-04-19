import { google } from 'googleapis';
import type { WorkspaceAction } from '../types/actions.js';
import { generateEditedEmailBody, generateEmailBody } from '../prompts/gmailMessageGenerator.js';
import { executeDocumentAction } from './documents.js';
import { executePresentationAction } from './presentations.js';
import { executeCalendarAction } from './calendar.js';
import type { ParseRouteResult } from './types.js';
import { parseRawEmailMessage } from './gmailDraft.js';
import { extractFileIdFromWorkspaceUrl } from './activeSession.js';
import { enrichDriveFile } from './drivePreview.js';

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const INVALID_RECIPIENT_PLACEHOLDERS = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'tbd']);

function normalizeShareRecipients(value: string[] | string | undefined): string[] {
	if (Array.isArray(value)) {
		return value.map((entry) => entry.trim()).filter(Boolean);
	}
	const trimmed = (value ?? '').trim();
	if (!trimmed) return [];
	return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeShareRecipient(entry: string): string | null {
	if (!entry) return null;
	if (INVALID_RECIPIENT_PLACEHOLDERS.has(entry.toLowerCase())) return null;
	if (SIMPLE_EMAIL_REGEX.test(entry)) return entry;
	const match = entry.match(/^.+<\s*([^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+)\s*>$/);
	return match && SIMPLE_EMAIL_REGEX.test(match[1]) ? match[1] : null;
}

async function shareFileWithDrive(
	oauthClient: unknown,
	fileId: string,
	recipients: string[],
	role: 'reader' | 'commenter' | 'writer',
	notify = true,
	message?: string,
): Promise<void> {
	const drive = google.drive({ version: 'v3', auth: oauthClient as any });
	for (const recipient of recipients) {
		await drive.permissions.create({
			fileId,
			sendNotificationEmail: notify,
			requestBody: {
				type: 'user',
				role,
				emailAddress: recipient,
				...(message ? { emailMessage: message } : {}),
			},
		});
	}
}

function normalizeToHeader(value: string | undefined): string | null {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return null;
	if (INVALID_RECIPIENT_PLACEHOLDERS.has(trimmed.toLowerCase())) return null;

	const recipients = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
	if (!recipients.length) return null;

	for (const recipient of recipients) {
		if (SIMPLE_EMAIL_REGEX.test(recipient)) continue;

		const match = recipient.match(/^.+<\s*([^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+)\s*>$/);
		if (match && SIMPLE_EMAIL_REGEX.test(match[1])) continue;

		return null;
	}

	return recipients.join(', ');
}

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
			return executePresentationAction(action, oauthClient, apiKey);

		case 'share_file': {
			const fileId = action.fileId?.trim() || (action.fileUrl ? extractFileIdFromWorkspaceUrl(action.fileUrl) : null);
			if (!fileId) throw new Error('share_file requires a fileId or fileUrl');

			const recipients = normalizeShareRecipients(action.recipients)
				.map(normalizeShareRecipient)
				.filter((recipient): recipient is string => !!recipient);
			if (!recipients.length) {
				return {
					action: 'clarify',
					title: 'Clarification needed',
					fileType: 'system',
					summary: 'Please provide one or more valid recipient email addresses.',
				};
			}

			const role = action.role ?? (action.fileType === 'drive' ? 'reader' : 'writer');
			await shareFileWithDrive(oauthClient, fileId, recipients, role, action.notify ?? true, action.message);

			let fileName = action.title?.trim();
			if (!fileName) {
				try {
					const drive = google.drive({ version: 'v3', auth: oauthClient as any });
					const meta = await drive.files.get({ fileId, fields: 'name' });
					fileName = meta.data.name ?? undefined;
				} catch {
					fileName = undefined;
				}
			}

			return {
				action: 'share_file',
				title: fileName ?? 'Shared file',
				url: action.fileUrl ?? `https://drive.google.com/open?id=${fileId}`,
				fileType: action.fileType ?? 'drive',
				summary: `Shared ${fileName ?? 'file'} with ${recipients.join(', ')} as ${role}${action.notify === false ? ' without notifications' : ''}`,
			};
		}

		case 'create_event': {
			return executeCalendarAction(
				action,
				{ document: null, spreadsheet: null, presentation: null, form: null, gmailDraft: null, calendarEvent: null, activeApp: null },
				'',
				oauthClient,
			);
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

		case 'create_draft':
		case 'edit_draft': {
			const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
			const requestedDraftId = action.action === 'edit_draft' ? action.draft_id?.trim() : undefined;

			let currentDraftBody = '';
			if (requestedDraftId) {
				try {
					const existingDraft = await gmail.users.drafts.get({ userId: 'me', id: requestedDraftId, format: 'raw' });
					const raw = existingDraft.data.message?.raw;
					if (raw) {
						currentDraftBody = parseRawEmailMessage(raw).body;
					}
				} catch (error) {
					console.error('[executeWorkspaceAction] failed to load current draft body:', error);
				}
			}

			const to = normalizeToHeader(action.to);
			const subject = action.subject?.trim();
			const bodyPrompt = action.body_prompt?.trim();

			if (!to) {
				return {
					action: 'clarify',
					title: 'Clarification needed',
					fileType: 'system',
					summary: 'Please provide a valid recipient email address (for example, name@example.com).',
				};
			}
			if (!subject || !bodyPrompt) throw new Error(`${action.action} requires to, subject, body_prompt`);

			const body = requestedDraftId
				? await generateEditedEmailBody(subject, currentDraftBody, bodyPrompt, apiKey)
				: await generateEmailBody(subject, bodyPrompt, apiKey);

			const raw = Buffer.from(
				[`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
			)
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/g, '');

			const draft = requestedDraftId
				? await gmail.users.drafts.update({
						userId: 'me',
						id: requestedDraftId,
						requestBody: {
							id: requestedDraftId,
							message: { raw },
						},
					})
				: await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });

			const draftId = draft.data.id || requestedDraftId;
			if (!draftId) throw new Error('Failed to create or update draft');

			return {
				action: action.action,
				title: subject,
				url: `https://mail.google.com/mail/#drafts/${draftId}`,
				fileType: 'gmail',
				summary: `${requestedDraftId ? 'Updated' : 'Drafted'} email to ${to}: ${subject}`,
			};
		}

		case 'send_email': {
			const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
			const to = normalizeToHeader(action.to);
			const subject = action.subject?.trim();
			const bodyPrompt = action.body_prompt?.trim();
			if (!to) {
				return {
					action: 'clarify',
					title: 'Clarification needed',
					fileType: 'system',
					summary: 'Please provide a valid recipient email address (for example, name@example.com).',
				};
			}
			if (!subject || !bodyPrompt) throw new Error('send_email requires to, subject, body_prompt');

			const body = await generateEmailBody(subject, bodyPrompt, apiKey);

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
				items: (result.data.files ?? []).map((file) => enrichDriveFile(file)),
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
				items: (result.data.files ?? []).map((file) => enrichDriveFile(file)),
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
