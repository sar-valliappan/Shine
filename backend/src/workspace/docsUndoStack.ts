/** Per-session undo for Google Docs: inverse batchUpdate requests or a Drive rename. */

export type DocsUndoBatch =
	| { kind: 'docs_batch'; documentId: string; requests: unknown[] }
	| { kind: 'drive_rename'; documentId: string; previousTitle: string };

const stacks = new Map<string, DocsUndoBatch[]>();
const MAX_DEPTH = 25;

export function pushDocsUndo(sessionId: string | undefined, batch: DocsUndoBatch): void {
	if (!sessionId) return;
	const cur = stacks.get(sessionId) ?? [];
	cur.push(batch);
	while (cur.length > MAX_DEPTH) cur.shift();
	stacks.set(sessionId, cur);
}

export function peekDocsUndo(sessionId: string | undefined): DocsUndoBatch | undefined {
	if (!sessionId) return undefined;
	return stacks.get(sessionId)?.at(-1);
}

export function popDocsUndo(sessionId: string | undefined): DocsUndoBatch | undefined {
	if (!sessionId) return undefined;
	const cur = stacks.get(sessionId);
	if (!cur?.length) return undefined;
	return cur.pop();
}
