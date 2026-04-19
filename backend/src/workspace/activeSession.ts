export type ActiveFileRef = { id: string; title: string };

export type ActiveWorkspace = {
	document: ActiveFileRef | null;
	spreadsheet: ActiveFileRef | null;
	presentation: ActiveFileRef | null;
};

const store = new Map<string, ActiveWorkspace>();

const empty = (): ActiveWorkspace => ({
	document: null,
	spreadsheet: null,
	presentation: null,
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
