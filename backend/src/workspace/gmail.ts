import { parseCommandWithGemini } from '../services/gemini.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';
import type { WorkspaceAction } from '../types/actions.js';

function isEditIntent(command: string): boolean {
	return /\b(edit|update|rewrite|change|revise|improve|polish|fix|shorten|expand|trim|remove|add|reword|make|tone|summarize|simplify)\b/i.test(command)
		|| /\b(this|that|it|draft|email|message)\b/i.test(command);
}

function buildEditDraftBodyPrompt(command: string, active: ActiveWorkspace): string {
	const draft = active.gmailDraft;
	if (!draft) return command;

	return [
		'Current Gmail draft context:',
		`Draft ID: ${draft.id}`,
		`Author: ${draft.author || '(unknown)'}`,
		`To: ${draft.to || '(unknown)'}`,
		`Subject: ${draft.subject || draft.title || '(untitled)'}`,
		'Current message:',
		draft.message || '(empty)',
		'Edit policy: make the smallest possible change and keep all unchanged paragraphs verbatim.',
		'',
		'User change request:',
		command,
	].join('\n');
}

export function normalizeGmailAction(action: WorkspaceAction, command: string, active: ActiveWorkspace): WorkspaceAction {
	if (active.gmailDraft && isEditIntent(command)) {
		if (action.action === 'clarify' || action.action === 'edit_document') {
			return {
				action: 'edit_draft',
				draft_id: active.gmailDraft.id,
				to: active.gmailDraft.to,
				subject: active.gmailDraft.subject || active.gmailDraft.title,
				body_prompt: buildEditDraftBodyPrompt(command, active),
			};
		}
	}

	if (action.action === 'create_draft' || action.action === 'edit_draft' || action.action === 'send_email' || action.action === 'clarify') {
		return action;
	}

	if (action.action === 'edit_document') {
		const candidate = action as WorkspaceAction & {
			to?: string;
			subject?: string;
			body_prompt?: string;
			content_prompt?: string;
			draft_id?: string;
		};

		if (candidate.to && candidate.subject && (candidate.body_prompt || candidate.content_prompt)) {
			return {
				action: 'edit_draft',
				draft_id: candidate.draft_id,
				to: candidate.to,
				subject: candidate.subject,
				body_prompt: candidate.body_prompt ?? candidate.content_prompt ?? '',
			};
		}

		return {
			action: 'clarify',
			question: 'I can edit Gmail drafts, but I need recipient, subject, and what to change in the body. Please include those details.',
		};
	}

	return {
		action: 'clarify',
		question: 'That looked like a non-Gmail action. Please ask using an email command (create draft, edit draft, or send email).',
	};
}

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Gmail-specific Gemini call
// that receives the user command + full Gmail API command list and returns
// the exact sequence of API operations to run.
export async function handleGmailCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	const normalizedAction = normalizeGmailAction(parsed.action, command, active);
	return executeWorkspaceAction(normalizedAction, oauthClient, apiKey);
}
