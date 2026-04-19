import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import {
	executeWorkspaceAction,
	extractFileIdFromWorkspaceUrl,
	getActiveWorkspace,
	updateActiveWorkspace,
} from '../workspace/index.js';

const router = Router();

function syncActiveFileFromResult(
	sessionId: string,
	actionName: string,
	url: string | undefined,
	title: string | undefined,
) {
	const id = url ? extractFileIdFromWorkspaceUrl(url) : null;
	if (!id) return;

	const prev = getActiveWorkspace(sessionId);
	const patch: Parameters<typeof updateActiveWorkspace>[1] = {};

	if (actionName === 'create_document' || actionName === 'edit_document') {
		const nextTitle =
			actionName === 'edit_document' && prev.document?.id === id
				? prev.document.title
				: (title ?? prev.document?.title ?? 'Untitled');
		patch.document = { id, title: nextTitle };
	}
	if (actionName === 'create_spreadsheet' || actionName === 'edit_spreadsheet') {
		const nextTitle =
			actionName === 'edit_spreadsheet' && prev.spreadsheet?.id === id
				? prev.spreadsheet.title
				: (title ?? prev.spreadsheet?.title ?? 'Untitled');
		patch.spreadsheet = { id, title: nextTitle };
	}
	if (actionName === 'create_presentation' || actionName === 'edit_presentation') {
		const nextTitle =
			actionName === 'edit_presentation' && prev.presentation?.id === id
				? prev.presentation.title
				: (title ?? prev.presentation?.title ?? 'Untitled');
		patch.presentation = { id, title: nextTitle };
	}
	if (Object.keys(patch).length) updateActiveWorkspace(sessionId, patch);
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
	try {
		const { command } = req.body as { command?: string };
		if (!command || typeof command !== 'string' || !command.trim()) {
			return res.status(400).json({ error: 'command is required' });
		}

		const sessionId = (req.session as any).id;
		const active = getActiveWorkspace(sessionId);

		const parsed = await parseCommandWithGemini(command.trim(), active);

		if (parsed.action.action === 'edit_document' && !parsed.action.fileId) {
			if (!active.document) return res.status(400).json({ error: 'No active document. Create a document first.' });
			parsed.action.fileId = active.document.id;
		}
		if (parsed.action.action === 'edit_spreadsheet' && !parsed.action.fileId) {
			if (!active.spreadsheet) return res.status(400).json({ error: 'No active spreadsheet. Create one first.' });
			parsed.action.fileId = active.spreadsheet.id;
		}
		if (parsed.action.action === 'edit_presentation' && !parsed.action.fileId) {
			if (!active.presentation) return res.status(400).json({ error: 'No active presentation. Create one first.' });
			parsed.action.fileId = active.presentation.id;
		}

		const result = await executeWorkspaceAction(parsed.action, req.oauthClient, process.env.GEMINI_API_KEY);

		if (result && 'url' in result && result.url) {
			syncActiveFileFromResult(sessionId, parsed.action.action, result.url as string, result.title as string | undefined);
		}

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
