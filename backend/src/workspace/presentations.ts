import type { WorkspaceAction } from '../types/actions.js';
import {
	addSlide,
	createStyledPresentation,
	deleteSlide,
	editSlide,
} from '../services/slidesService.js';
import type { ParseRouteResult } from './types.js';

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
