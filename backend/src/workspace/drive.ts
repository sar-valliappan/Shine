import { parseCommandWithGemini } from '../services/gemini.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Drive-specific Gemini call
// that receives the user command + full Drive API command list and returns
// the exact sequence of API operations to run.
export async function handleDriveCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	return executeWorkspaceAction(parsed.action, oauthClient, apiKey);
}
