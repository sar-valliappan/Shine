import type { WorkspaceAction } from '../types/actions.js';
import {
	addSlide,
	createStyledPresentation,
	deleteSlide,
	editSlide,
} from '../services/slidesService.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import type { ActiveWorkspace } from './activeSession.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ParseRouteResult } from './types.js';

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Slides-specific Gemini call
// that receives the user command + full Slides API command list and returns
// the exact sequence of API operations to run.
export async function handleSlidesCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	const action = parsed.action;
	if (action.action === 'share_file') {
		if (!action.fileId && active.presentation) {
			action.fileId = active.presentation.id;
			action.fileType = 'slides';
			action.title = active.presentation.title;
		}
		return executeWorkspaceAction(action, oauthClient, apiKey);
	}
	if (action.action === 'edit_presentation' && !action.fileId && active.presentation) {
		action.fileId = active.presentation.id;
	}
	return executePresentationAction(action as Extract<WorkspaceAction, { action: 'create_presentation' | 'edit_presentation' }>, oauthClient, apiKey);
}

type PresAction = Extract<WorkspaceAction, { action: 'create_presentation' | 'edit_presentation' }>;

export async function executePresentationAction(
	action: PresAction,
	oauthClient: unknown,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	if (action.action === 'create_presentation') {
		const title = action.title?.trim();
		if (!title) throw new Error('create_presentation requires title');
		const prompts = action.slide_prompts?.length ? action.slide_prompts : ['Title slide', 'Key points', 'Next steps'];

		const { url, slideCount } = await createStyledPresentation(title, prompts, oauthClient, apiKey);

		return {
			action: 'create_presentation',
			title,
			url,
			fileType: 'slides',
			summary: `Created "${title}" — ${slideCount} styled slides`,
		};
	}

	const fileId = action.fileId;
	if (!fileId) throw new Error('No active presentation to edit. Create one first.');

	const url = `https://docs.google.com/presentation/d/${fileId}/edit`;

	if (action.operation === 'add_slide') {
		const { title } = await addSlide(fileId, action.slide_prompt ?? 'New slide', oauthClient, apiKey);
		return { action: 'edit_presentation', title, url, fileType: 'slides', summary: `Added slide: "${title}"` };
	}

	if (action.operation === 'edit_slide') {
		const idx = action.slide_index ?? 0;
		await editSlide(fileId, idx, { title: action.title, body: action.body }, oauthClient);
		return {
			action: 'edit_presentation',
			title: action.title ?? `Slide ${idx + 1}`,
			url,
			fileType: 'slides',
			summary: `Updated slide ${idx + 1}`,
		};
	}

	if (action.operation === 'delete_slide') {
		const idx = action.slide_index ?? 0;
		await deleteSlide(fileId, idx, oauthClient);
		return {
			action: 'edit_presentation',
			title: `Slide ${idx + 1} deleted`,
			url,
			fileType: 'slides',
			summary: `Deleted slide ${idx + 1}`,
		};
	}

	throw new Error(`Unknown edit_presentation operation: ${action.operation}`);
}
