import { GoogleGenerativeAI } from '@google/generative-ai';
import { commandParserPrompt } from '../prompts/commandParser.js';
import { buildAppRouterPrompt } from '../prompts/appRouter.js';
import type { ParseResult, WorkspaceAction } from '../types/actions.js';
import type { ActiveWorkspace } from '../workspace/activeSession.js';
import type { AppName } from '../workspace/app-router.js';

function indentBlock(text: string, indent = '  '): string {
	return text
		.split('\n')
		.map((line) => `${indent}${line}`)
		.join('\n');
}

function formatActiveWorkspaceContext(active: ActiveWorkspace): string {
	const lines: string[] = [];
	if (active.document) {
		lines.push(`Google Doc — title: "${active.document.title}", file id: ${active.document.id}`);
	}
	if (active.spreadsheet) {
		lines.push(`Google Sheet — title: "${active.spreadsheet.title}", file id: ${active.spreadsheet.id}`);
	}
	if (active.presentation) {
		lines.push(`Google Slides — title: "${active.presentation.title}", file id: ${active.presentation.id}`);
	}
	if (active.gmailDraft) {
		lines.push(
			[
				`Gmail Draft — draft id: ${active.gmailDraft.id}`,
				`author: ${active.gmailDraft.author || '(unknown)'}`,
				`subject: ${active.gmailDraft.subject || active.gmailDraft.title || '(untitled)'}`,
				`to: ${active.gmailDraft.to || '(unknown)'}`,
				'message:',
				indentBlock(active.gmailDraft.message || '(empty)')
			].join('\n')
		);
	}
	if (active.calendarEvent) {
		lines.push(
			[
				`Calendar Event — event id: ${active.calendarEvent.id}`,
				`calendar id: ${active.calendarEvent.calendarId}`,
				`title: ${active.calendarEvent.title || '(untitled)'}`,
				`start: ${active.calendarEvent.start_time || '(unknown)'}`,
				`end: ${active.calendarEvent.end_time || '(unknown)'}`,
				`location: ${active.calendarEvent.location || '(none)'}`,
				'description:',
				indentBlock(active.calendarEvent.description || '(empty)'),
			].join('\n')
		);
	}
	if (!lines.length) return '';
	return `\n\nActive workspace — the user may refer to these without naming them:\n${lines.map((l) => `- ${l}`).join('\n')}
When they want to change the open doc, use edit_document. For the open sheet, edit_spreadsheet. For the open deck, edit_presentation. For the open Gmail draft, use edit_draft and include draft_id when available.
For the open calendar event, always use create_event with the updated summary/start_time/end_time/location/description; the backend will apply that as an edit to the active event unless the user explicitly asks to create a new event.
If the command is an edit/update request without explicitly naming another app, apply it to the currently active item type from this context.`;
}

const DEFAULT_MODEL_CANDIDATES = [
	'gemma-3-27b-it',
	'gemma-3-12b-it',
	'gemma-3-4b-it',
] as const;

function extractFirstJsonObject(text: string): string {
	const start = text.indexOf('{');
	if (start === -1) throw new Error('No JSON object found in response');

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (escaped) { escaped = false; continue; }
		if (char === '\\') { escaped = true; continue; }
		if (char === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (char === '{') depth++;
		if (char === '}') {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}

	throw new Error('Unbalanced JSON object in response');
}

function parseJsonPayload(text: string): WorkspaceAction {
	const cleaned = text
		.trim()
		.replace(/^```json\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/```\s*$/i, '');

	const jsonPayload = cleaned.startsWith('{') ? cleaned : extractFirstJsonObject(cleaned);
	const parsed = JSON.parse(jsonPayload) as WorkspaceAction;

	if (!parsed || typeof parsed !== 'object' || !('action' in parsed)) {
		throw new Error('Gemini response missing action field');
	}
	return parsed;
}

export async function parseCommandWithGemini(
	command: string,
	active: ActiveWorkspace = { document: null, spreadsheet: null, presentation: null, gmailDraft: null, calendarEvent: null, activeApp: null },
): Promise<ParseResult> {
	const apiKey = process.env.GEMINI_API_KEY;

	if (!apiKey) {
		return {
			action: { action: 'clarify', question: 'The AI service is not configured. Please contact support.' },
			rawText: 'GEMINI_API_KEY not configured',
		};
	}

	const client = new GoogleGenerativeAI(apiKey);

	const contextBlock = formatActiveWorkspaceContext(active);

	const prompt = `${commandParserPrompt}${contextBlock}\n\nUser command:\n${command}`;

	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const modelCandidates = configuredModel
		? [configuredModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== configuredModel)]
		: [...DEFAULT_MODEL_CANDIDATES];

	let text = '';
	let lastError: unknown = null;

	for (const modelName of modelCandidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
			const result = await model.generateContent(prompt);
			text = result.response.text();
			lastError = null;
			break;
		} catch (error) {
			console.error(`[gemini] Model failed: ${modelName}`, error);
			lastError = error;
		}
	}

	if (!text) {
		console.error('[gemini] All models failed:', lastError);
		return {
			action: { action: 'clarify', question: 'I had trouble connecting to the AI service. Please try again.' },
			rawText: `All models failed: ${String(lastError)}`,
		};
	}

	try {
		const action = parseJsonPayload(text);
		return { action, rawText: text };
	} catch (error) {
		console.error('[gemini] Failed to parse response:', text, error);
		return {
			action: { action: 'clarify', question: 'I understood your request but had trouble formatting it. Could you rephrase?' },
			rawText: text,
		};
	}
}

const VALID_APP_NAMES: AppName[] = ['docs', 'sheets', 'slides', 'gmail', 'forms', 'drive', 'calendar'];

export async function routeToApp(command: string, active: ActiveWorkspace = { document: null, spreadsheet: null, presentation: null, gmailDraft: null, calendarEvent: null, activeApp: null }): Promise<AppName | null> {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;

	const client = new GoogleGenerativeAI(apiKey);
	const activeContext = formatActiveWorkspaceContext(active);
	const prompt = buildAppRouterPrompt(command, activeContext);

	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const modelCandidates = configuredModel
		? [configuredModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== configuredModel)]
		: [...DEFAULT_MODEL_CANDIDATES];

	for (const modelName of modelCandidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
			const result = await model.generateContent(prompt);
			const raw = result.response.text().trim().toLowerCase();
			const matched = VALID_APP_NAMES.find((name) => raw.startsWith(name));
			if (matched) return matched;
		} catch (error) {
			console.error(`[gemini:router] Model failed: ${modelName}`, error);
		}
	}

	return null;
}
