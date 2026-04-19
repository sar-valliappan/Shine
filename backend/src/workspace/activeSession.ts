export type ActiveFileRef = { id: string; title: string };

export type ActiveGmailDraftRef = {
	id: string;
	title: string;
	author: string;
	subject: string;
	message: string;
	to: string;
};

export type ActiveWorkspace = {
	document: ActiveFileRef | null;
	spreadsheet: ActiveFileRef | null;
	presentation: ActiveFileRef | null;
	gmailDraft: ActiveGmailDraftRef | null;
};

const store = new Map<string, ActiveWorkspace>();

const empty = (): ActiveWorkspace => ({
	document: null,
	spreadsheet: null,
	presentation: null,
	gmailDraft: null,
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
