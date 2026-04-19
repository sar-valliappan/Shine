import { google } from 'googleapis';
import { parseFormsCommand } from '../services/gemini.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { FormQuestion } from '../types/actions.js';
import type { ParseRouteResult } from './types.js';

// ── Question builder ───────────────────────────────────────────────────────

function buildQuestionItem(q: FormQuestion): object {
	const base = { required: q.required ?? false };

	switch (q.type) {
		case 'SHORT_TEXT':
			return { ...base, textQuestion: { paragraph: false } };
		case 'PARAGRAPH':
			return { ...base, textQuestion: { paragraph: true } };
		case 'MULTIPLE_CHOICE':
			return {
				...base,
				choiceQuestion: {
					type: 'RADIO',
					options: (q.options ?? []).map((v) => ({ value: v })),
				},
			};
		case 'CHECKBOX':
			return {
				...base,
				choiceQuestion: {
					type: 'CHECKBOX',
					options: (q.options ?? []).map((v) => ({ value: v })),
				},
			};
		case 'DROPDOWN':
			return {
				...base,
				choiceQuestion: {
					type: 'DROP_DOWN',
					options: (q.options ?? []).map((v) => ({ value: v })),
				},
			};
		case 'LINEAR_SCALE':
			return { ...base, scaleQuestion: { low: 1, high: 5 } };
		case 'DATE':
			return { ...base, dateQuestion: {} };
		case 'TIME':
			return { ...base, timeQuestion: {} };
		default:
			return { ...base, textQuestion: { paragraph: false } };
	}
}

function buildCreateItemRequest(q: FormQuestion, index: number): object {
	return {
		createItem: {
			item: {
				title: q.title,
				questionItem: { question: buildQuestionItem(q) },
			},
			location: { index },
		},
	};
}

// ── Core action executor ───────────────────────────────────────────────────

export async function executeFormAction(
	action: import('../types/actions.js').WorkspaceAction,
	oauthClient: unknown,
): Promise<ParseRouteResult> {
	const forms = google.forms({ version: 'v1', auth: oauthClient as any });

	if (action.action === 'create_form') {
		const title = action.title?.trim();
		if (!title) throw new Error('create_form requires a title');
		if (!action.questions?.length) throw new Error('create_form requires at least one question');

		// forms.create only accepts info.title — everything else must go through batchUpdate
		const created = await forms.forms.create({
			requestBody: { info: { title } },
		});
		const formId = created.data.formId;
		if (!formId) throw new Error('Failed to create form — no formId returned');

		const requests: object[] = [];

		// Set description if provided
		if (action.description?.trim()) {
			requests.push({
				updateFormInfo: {
					info: { description: action.description.trim() },
					updateMask: 'description',
				},
			});
		}

		// Add all questions
		requests.push(...action.questions.map((q, i) => buildCreateItemRequest(q, i)));

		await forms.forms.batchUpdate({ formId, requestBody: { requests } });

		return {
			action: 'create_form',
			title,
			url: `https://docs.google.com/forms/d/${formId}/edit`,
			fileType: 'form',
			summary: `Created Google Form: ${title} with ${action.questions.length} question${action.questions.length === 1 ? '' : 's'}`,
		};
	}

	if (action.action === 'edit_form') {
		const formId = action.fileId?.trim();
		if (!formId) throw new Error('edit_form requires a fileId');

		const requests: object[] = [];

		if (action.operation === 'add_question') {
			if (!action.question) throw new Error('edit_form add_question requires a question object');
			const form = await forms.forms.get({ formId });
			const nextIndex = (form.data.items ?? []).length;
			requests.push(buildCreateItemRequest(action.question, nextIndex));
		}

		if (action.operation === 'delete_question') {
			const form = await forms.forms.get({ formId });
			const items = form.data.items ?? [];
			let targetItem: (typeof items)[number] | undefined;

			if (typeof action.question_index === 'number') {
				// support negative indices: -1 = last, -2 = second to last, etc.
				const idx = action.question_index < 0
					? items.length + action.question_index
					: action.question_index;
				targetItem = items[idx];
			} else if (action.question_title) {
				const needle = action.question_title.toLowerCase();
				targetItem = items.find((it) => it.title?.toLowerCase().includes(needle));
			}
			if (!targetItem?.itemId) throw new Error('Could not find the question to delete');
			requests.push({ deleteItem: { location: { index: items.indexOf(targetItem) } } });
		}

		if (action.operation === 'update_title') {
			if (!action.new_title?.trim()) throw new Error('edit_form update_title requires new_title');
			requests.push({
				updateFormInfo: {
					info: { title: action.new_title.trim() },
					updateMask: 'title',
				},
			});
		}

		if (action.operation === 'update_description') {
			if (action.new_description === undefined) throw new Error('edit_form update_description requires new_description');
			requests.push({
				updateFormInfo: {
					info: { description: action.new_description },
					updateMask: 'description',
				},
			});
		}

		if (requests.length) {
			await forms.forms.batchUpdate({ formId, requestBody: { requests } });
		}

		const updated = await forms.forms.get({ formId });
		const title = updated.data.info?.title ?? 'Untitled Form';

		return {
			action: 'edit_form',
			title,
			url: `https://docs.google.com/forms/d/${formId}/edit`,
			fileType: 'form',
			summary: `Updated form: ${title}`,
		};
	}

	throw new Error(`executeFormAction: unhandled action ${(action as any).action}`);
}

// ── App-level entry point (called by app-router) ───────────────────────────

export async function handleFormsCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseFormsCommand(command, active);

	if (parsed.action.action === 'share_file' && !parsed.action.fileId && active.form) {
		parsed.action.fileId = active.form.id;
		parsed.action.fileType = 'form';
		parsed.action.title = active.form.title;
		return executeWorkspaceAction(parsed.action, oauthClient, apiKey);
	}

	if (parsed.action.action === 'edit_form' && !parsed.action.fileId && active.form) {
		parsed.action.fileId = active.form.id;
	}

	if (parsed.action.action === 'create_form' || parsed.action.action === 'edit_form') {
		return executeFormAction(parsed.action, oauthClient);
	}

	return executeWorkspaceAction(parsed.action, oauthClient, apiKey);
}
