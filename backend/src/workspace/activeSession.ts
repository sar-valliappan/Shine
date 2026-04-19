export type ActiveFileRef = { id: string; title: string };

export type ActiveGmailDraftRef = {
	id: string;
	title: string;
	author: string;
	subject: string;
	message: string;
	to: string;
};

export type ActiveCalendarEventRef = {
	id: string;
	calendarId: string;
	title: string;
	start_time?: string;
	end_time?: string;
	location?: string;
	description?: string;
};

export type ActiveApp = 'docs' | 'sheets' | 'slides' | 'gmail' | 'forms' | 'drive' | 'calendar' | null;

export type ActiveWorkspace = {
	document: ActiveFileRef | null;
	spreadsheet: ActiveFileRef | null;
	presentation: ActiveFileRef | null;
	form: ActiveFileRef | null;
	gmailDraft: ActiveGmailDraftRef | null;
	calendarEvent: ActiveCalendarEventRef | null;
	activeApp: ActiveApp;
};

const store = new Map<string, ActiveWorkspace>();

const empty = (): ActiveWorkspace => ({
	document: null,
	spreadsheet: null,
	presentation: null,
	form: null,
	gmailDraft: null,
	calendarEvent: null,
	activeApp: null,
});

export function getActiveWorkspace(sessionId: string): ActiveWorkspace {
	return store.get(sessionId) ?? empty();
}

export function updateActiveWorkspace(sessionId: string, patch: Partial<ActiveWorkspace>): void {
	const cur = getActiveWorkspace(sessionId);
	store.set(sessionId, { ...cur, ...patch });
}

export function extractFileIdFromWorkspaceUrl(url: string): string | null {
	return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

export function extractGmailDraftIdFromUrl(url: string): string | null {
	return url.match(/#drafts\/([^/?]+)/i)?.[1] ?? null;
}
