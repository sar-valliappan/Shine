import { parseCommandWithGemini } from '../services/gemini.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Forms-specific Gemini call
// that receives the user command + full Forms API command list and returns
// the exact sequence of API operations to run.
export async function handleFormsCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	if (parsed.action.action === 'share_file' && !parsed.action.fileId && active.form) {
		parsed.action.fileId = active.form.id;
		parsed.action.fileType = 'form';
		parsed.action.title = active.form.title;
	}
	return executeWorkspaceAction(parsed.action, oauthClient, apiKey);
}
