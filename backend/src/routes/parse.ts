import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { routeToApp } from '../services/gemini.js';
import {
	executeAppCommand,
	extractFileIdFromWorkspaceUrl,
	getActiveWorkspace,
	updateActiveWorkspace,
} from '../workspace/index.js';

const router = Router();

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Syncs the in-memory workspace with whatever file the UI has open.
 * Critical for cross-origin setups (e.g. Vite :5173 → API :3001) where the
 * express-session cookie may differ per request, so server-side workspace state
 * set during 'create' may not be visible on the next 'edit' request.
 */
function applyClientWorkspaceHints(
	sessionId: string,
	body: {
		activeDocumentId?: string;
		activeDocumentTitle?: string;
		activeSpreadsheetId?: string;
		activeSpreadsheetTitle?: string;
		activePresentationId?: string;
		activePresentationTitle?: string;
	},
): void {
	const prev = getActiveWorkspace(sessionId);

	// If the frontend sent the key (even empty), treat it as ground truth.
	// Empty string means the user closed that file — clear stale session state.
	if (typeof body.activeDocumentId === 'string') {
		const docId = body.activeDocumentId.trim();
		if (docId && DRIVE_FILE_ID_RE.test(docId)) {
			const title =
				typeof body.activeDocumentTitle === 'string' && body.activeDocumentTitle.trim()
					? body.activeDocumentTitle.trim()
					: prev.document?.id === docId ? prev.document.title : 'Untitled';
			updateActiveWorkspace(sessionId, { document: { id: docId, title } });
		} else {
			updateActiveWorkspace(sessionId, { document: null });
		}
	}

	if (typeof body.activeSpreadsheetId === 'string') {
		const sheetId = body.activeSpreadsheetId.trim();
		if (sheetId && DRIVE_FILE_ID_RE.test(sheetId)) {
			const title =
				typeof body.activeSpreadsheetTitle === 'string' && body.activeSpreadsheetTitle.trim()
					? body.activeSpreadsheetTitle.trim()
					: prev.spreadsheet?.id === sheetId ? prev.spreadsheet.title : 'Untitled';
			updateActiveWorkspace(sessionId, { spreadsheet: { id: sheetId, title } });
		} else {
			updateActiveWorkspace(sessionId, { spreadsheet: null });
		}
	}

	if (typeof body.activePresentationId === 'string') {
		const presId = body.activePresentationId.trim();
		if (presId && DRIVE_FILE_ID_RE.test(presId)) {
			const title =
				typeof body.activePresentationTitle === 'string' && body.activePresentationTitle.trim()
					? body.activePresentationTitle.trim()
					: prev.presentation?.id === presId ? prev.presentation.title : 'Untitled';
			updateActiveWorkspace(sessionId, { presentation: { id: presId, title } });
		} else {
			updateActiveWorkspace(sessionId, { presentation: null });
		}
	}
}

function syncActiveFileFromResult(
	sessionId: string,
	actionName: string,
	url: string | undefined,
	title: string | undefined,
	activeDocumentTitle?: string,
	documentTitleHint?: string,
) {
	const id = url ? extractFileIdFromWorkspaceUrl(url) : null;
	if (!id) return;

	const prev = getActiveWorkspace(sessionId);
	const patch: Parameters<typeof updateActiveWorkspace>[1] = {};

	if (actionName === 'create_document' || actionName === 'edit_document') {
		const nextTitle =
			actionName === 'edit_document' && prev.document?.id === id
				? (activeDocumentTitle ?? documentTitleHint ?? prev.document.title)
				: (activeDocumentTitle ?? documentTitleHint ?? title ?? prev.document?.title ?? 'Untitled');
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
		const body = req.body as {
			command?: string;
			activeDocumentId?: string;
			activeDocumentTitle?: string;
			activeSpreadsheetId?: string;
			activeSpreadsheetTitle?: string;
			activePresentationId?: string;
			activePresentationTitle?: string;
		};

		const { command } = body;
		if (!command || typeof command !== 'string' || !command.trim()) {
			return res.status(400).json({ error: 'command is required' });
		}

		// req.sessionID is the correct express-session property (not req.session.id)
		const sessionId = req.sessionID;
		applyClientWorkspaceHints(sessionId, body);
		const active = getActiveWorkspace(sessionId);

		// Step 1: Gemini decides which app the user wants
		const app = await routeToApp(command.trim());
		if (!app) {
			return res.status(400).json({ error: "I couldn't determine which app you want to use. Try mentioning docs, sheets, slides, gmail, forms, drive, or calendar." });
		}

		// Step 2: App-specific handler takes over
		const result = await executeAppCommand(app, command.trim(), req.oauthClient, active, process.env.GEMINI_API_KEY, sessionId);

		if (result?.url) {
			syncActiveFileFromResult(sessionId, result.action, result.url, result.title, result.activeDocumentTitle, result.documentTitle);
		}

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
