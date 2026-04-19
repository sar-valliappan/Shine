import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { routeToApp } from '../services/gemini.js';
import {
	executeAppCommand,
	extractFileIdFromWorkspaceUrl,
	extractGmailDraftIdFromUrl,
	loadGmailDraftContext,
	getActiveWorkspace,
	updateActiveWorkspace,
	type AppName,
} from '../workspace/index.js';

const router = Router();

function chooseAppFromActiveContext(command: string, active: ReturnType<typeof getActiveWorkspace>): AppName | null {
	const text = command.trim().toLowerCase();
	const isCreateIntent = /\b(create|new|start|generate|draft|compose|write|build|make)\b/.test(text);
	if (isCreateIntent) return null;

	const looksLikeEdit = /\b(edit|update|rewrite|change|revise|improve|polish|fix|add|remove|append|replace|delete|shorten|expand|reword|summarize|simplify)\b/.test(text);
	if (!looksLikeEdit) return null;

	const explicitAppMention = /\b(gmail|email|mail|draft|doc|document|sheet|spreadsheet|slide|slides|presentation|calendar|form|drive|file)\b/.test(text);
	if (explicitAppMention) return null;

	// Prefer the currently active Gmail draft for ambiguous edit requests.
	if (active.gmailDraft) {
		return 'gmail';
	}

	if (active.document) {
		return 'docs';
	}
	if (active.spreadsheet) {
		return 'sheets';
	}
	if (active.presentation) {
		return 'slides';
	}

	return null;
}

async function syncActiveFileFromResult(
	sessionId: string,
	actionName: string,
	url: string | undefined,
	title: string | undefined,
	oauthClient: unknown,
) {
	const workspaceFileId = url ? extractFileIdFromWorkspaceUrl(url) : null;
	const gmailDraftId = url ? extractGmailDraftIdFromUrl(url) : null;

	const prev = getActiveWorkspace(sessionId);
	const patch: Parameters<typeof updateActiveWorkspace>[1] = {};

	if (workspaceFileId && (actionName === 'create_document' || actionName === 'edit_document')) {
		const nextTitle =
			actionName === 'edit_document' && prev.document?.id === workspaceFileId
				? prev.document.title
				: (title ?? prev.document?.title ?? 'Untitled');
		patch.document = { id: workspaceFileId, title: nextTitle };
	}
	if (workspaceFileId && (actionName === 'create_spreadsheet' || actionName === 'edit_spreadsheet')) {
		const nextTitle =
			actionName === 'edit_spreadsheet' && prev.spreadsheet?.id === workspaceFileId
				? prev.spreadsheet.title
				: (title ?? prev.spreadsheet?.title ?? 'Untitled');
		patch.spreadsheet = { id: workspaceFileId, title: nextTitle };
	}
	if (workspaceFileId && (actionName === 'create_presentation' || actionName === 'edit_presentation')) {
		const nextTitle =
			actionName === 'edit_presentation' && prev.presentation?.id === workspaceFileId
				? prev.presentation.title
				: (title ?? prev.presentation?.title ?? 'Untitled');
		patch.presentation = { id: workspaceFileId, title: nextTitle };
	}
	if (gmailDraftId && (actionName === 'create_draft' || actionName === 'edit_draft')) {
		try {
			const loadedDraft = await loadGmailDraftContext(oauthClient, gmailDraftId);
			const nextTitle =
				actionName === 'edit_draft' && prev.gmailDraft?.id === gmailDraftId
					? prev.gmailDraft.title
					: (loadedDraft?.subject ?? title ?? prev.gmailDraft?.title ?? 'Untitled');
			patch.gmailDraft = loadedDraft
				? {
					id: loadedDraft.id,
					title: nextTitle,
					author: loadedDraft.author,
					subject: loadedDraft.subject,
					message: loadedDraft.message,
					to: loadedDraft.to,
				}
				: {
					id: gmailDraftId,
					title: nextTitle,
					author: prev.gmailDraft?.author ?? '',
					subject: prev.gmailDraft?.subject ?? nextTitle,
					message: prev.gmailDraft?.message ?? '',
					to: prev.gmailDraft?.to ?? '',
				};
		} catch (error) {
			console.error('[parse] failed to refresh Gmail draft context:', error);
		}
	}
	if (actionName === 'send_email') {
		patch.gmailDraft = null;
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

		// Step 1: Gemini decides which app the user wants
		const app = chooseAppFromActiveContext(command, active) ?? (await routeToApp(command.trim(), active));
		if (!app) {
			return res.status(400).json({ error: "I couldn't determine which app you want to use. Try mentioning docs, sheets, slides, gmail, forms, drive, or calendar." });
		}

		// Step 2: App-specific handler takes over
		const result = await executeAppCommand(app, command.trim(), req.oauthClient, active, process.env.GEMINI_API_KEY);

		if (result?.url) {
			await syncActiveFileFromResult(sessionId, result.action, result.url, result.title, req.oauthClient);
		}

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
