import { google } from 'googleapis';

export type GmailDraftContext = {
	id: string;
	author: string;
	subject: string;
	message: string;
	to: string;
};

function getHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | null | undefined, key: string): string {
	if (!headers) return '';
	const match = headers.find((header) => (header.name || '').toLowerCase() === key.toLowerCase());
	return match?.value || '';
}

function decodeBase64Url(value: string): string {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padLength = (4 - (normalized.length % 4)) % 4;
	return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf-8');
}

export function parseRawEmailMessage(raw: string): { author: string; to: string; subject: string; body: string } {
	const decoded = decodeBase64Url(raw);
	const lines = decoded.split(/\r?\n/);
	let index = 0;
	let author = '';
	let to = '';
	let subject = '';

	for (; index < lines.length; index++) {
		const line = lines[index];
		if (!line.trim()) {
			index += 1;
			break;
		}

		const separatorIndex = line.indexOf(':');
		if (separatorIndex === -1) continue;

		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const value = line.slice(separatorIndex + 1).trim();
		if (key === 'from') author = value;
		if (key === 'to') to = value;
		if (key === 'subject') subject = value;
	}

	const body = lines.slice(index).join('\n');
	return { author, to, subject, body };
}

export async function loadGmailDraftContext(oauthClient: unknown, draftId: string): Promise<GmailDraftContext | null> {
	if (!draftId.trim()) return null;

	try {
		const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
		const draftResponse = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'raw' });
		const profileResponse = await gmail.users.getProfile({ userId: 'me' }).catch(() => null);

		const raw = draftResponse.data.message?.raw;
		if (!raw) return null;

		const parsed = parseRawEmailMessage(raw);
		const draft = draftResponse.data;
		const headers = draft.message?.payload?.headers;
		const subject = parsed.subject || getHeaderValue(headers, 'Subject') || '(no subject)';
		const to = parsed.to || getHeaderValue(headers, 'To') || '';
		const author = parsed.author || getHeaderValue(headers, 'From') || profileResponse?.data.emailAddress || '';

		return {
			id: draft.id || draftId,
			author,
			subject,
			message: parsed.body,
			to,
		};
	} catch (error) {
		console.error('[loadGmailDraftContext] failed:', error);
		return null;
	}
}