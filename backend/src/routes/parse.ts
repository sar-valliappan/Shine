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
} from '../workspace/index.js';
import type { ParseRouteResult } from '../workspace/types.js';

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

async function syncActiveFileFromResult(
	sessionId: string,
	result: ParseRouteResult,
	oauthClient: unknown,
): Promise<void> {
	const actionName = result.action;
	const url = result.url;
	const title = result.title;
	const activeDocumentTitle = result.activeDocumentTitle;
	const documentTitleHint = result.documentTitle;
	const workspaceFileId = url ? extractFileIdFromWorkspaceUrl(url) : null;
	const gmailDraftId = url ? extractGmailDraftIdFromUrl(url) : null;

	const prev = getActiveWorkspace(sessionId);
	const patch: Parameters<typeof updateActiveWorkspace>[1] = {};

	if (workspaceFileId && (actionName === 'create_document' || actionName === 'edit_document')) {
		const nextTitle =
			actionName === 'edit_document' && prev.document?.id === workspaceFileId
				? (activeDocumentTitle ?? documentTitleHint ?? prev.document.title)
				: (activeDocumentTitle ?? documentTitleHint ?? title ?? prev.document?.title ?? 'Untitled');
		patch.document = { id: workspaceFileId, title: nextTitle };
		patch.activeApp = 'docs';
	}
	if (workspaceFileId && (actionName === 'create_spreadsheet' || actionName === 'edit_spreadsheet')) {
		const nextTitle =
			actionName === 'edit_spreadsheet' && prev.spreadsheet?.id === workspaceFileId
				? prev.spreadsheet.title
				: (title ?? prev.spreadsheet?.title ?? 'Untitled');
		patch.spreadsheet = { id: workspaceFileId, title: nextTitle };
		patch.activeApp = 'sheets';
	}
	if (workspaceFileId && (actionName === 'create_presentation' || actionName === 'edit_presentation')) {
		const nextTitle =
			actionName === 'edit_presentation' && prev.presentation?.id === workspaceFileId
				? prev.presentation.title
				: (title ?? prev.presentation?.title ?? 'Untitled');
		patch.presentation = { id: workspaceFileId, title: nextTitle };
		patch.activeApp = 'slides';
	}
	if (workspaceFileId && actionName === 'create_form') {
		patch.form = { id: workspaceFileId, title: title ?? prev.form?.title ?? 'Untitled' };
		patch.activeApp = 'forms';
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
			patch.activeApp = 'gmail';
		} catch (error) {
			console.error('[parse] failed to refresh Gmail draft context:', error);
		}
	}
	if (actionName === 'send_email') {
		patch.gmailDraft = null;
		if (prev.activeApp === 'gmail') patch.activeApp = null;
	}
	if ((actionName === 'create_event' || actionName === 'update_event') && result.eventId) {
		patch.calendarEvent = {
			id: result.eventId,
			calendarId: result.calendarId ?? prev.calendarEvent?.calendarId ?? 'primary',
			title: title ?? prev.calendarEvent?.title ?? 'Untitled Event',
			start_time: result.start_time,
			end_time: result.end_time,
			location: result.location,
			description: result.description,
		};
		patch.activeApp = 'calendar';
	}

	if (workspaceFileId && (result.fileType === 'doc' || result.fileType === 'sheet' || result.fileType === 'slides' || result.fileType === 'form')) {
		if (result.fileType === 'doc') {
			patch.document = { id: workspaceFileId, title: activeDocumentTitle ?? documentTitleHint ?? title ?? prev.document?.title ?? 'Untitled' };
			patch.activeApp = 'docs';
		} else if (result.fileType === 'sheet') {
			patch.spreadsheet = { id: workspaceFileId, title: title ?? prev.spreadsheet?.title ?? 'Untitled' };
			patch.activeApp = 'sheets';
		} else if (result.fileType === 'slides') {
			patch.presentation = { id: workspaceFileId, title: title ?? prev.presentation?.title ?? 'Untitled' };
			patch.activeApp = 'slides';
		} else if (result.fileType === 'form') {
			patch.form = { id: workspaceFileId, title: title ?? prev.form?.title ?? 'Untitled' };
			patch.activeApp = 'forms';
		}
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
		const app = await routeToApp(command.trim(), active);
		if (!app) {
			return res.status(400).json({ error: "I couldn't determine which app you want to use. Try mentioning docs, sheets, slides, gmail, forms, drive, or calendar." });
		}

		// Step 2: App-specific handler takes over
		const result = await executeAppCommand(app, command.trim(), req.oauthClient, active, process.env.GEMINI_API_KEY, sessionId);
		await syncActiveFileFromResult(sessionId, result, req.oauthClient);

		return res.json(result);
	} catch (error) {
		console.error('Parse route failed:', error);
		const message = error instanceof Error ? error.message : 'Failed to parse command';
		return res.status(500).json({ error: message });
	}
});

export default router;
