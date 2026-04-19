import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import { commandParserPrompt } from '../prompts/commandParser.js';
import { appRouterPrompt } from '../prompts/appRouter.js';
import { extractDocumentContext } from './googleDocsBodyHelpers.js';
import type { ParseResult, WorkspaceAction } from '../types/actions.js';
import type { ActiveWorkspace } from '../workspace/activeSession.js';
import type { AppName } from '../workspace/app-router.js';

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
	if (!lines.length) return '';
	return `\n\nActive workspace — the user may refer to these without naming them:\n${lines.map((l) => `- ${l}`).join('\n')}
When they want to change the open doc, use edit_document. For the open sheet, edit_spreadsheet. For the open deck, edit_presentation.`;
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

async function generateParsedActionFromPrompt(fullPrompt: string): Promise<ParseResult> {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return {
			action: { action: 'clarify', question: 'The AI service is not configured. Please contact support.' },
			rawText: 'GEMINI_API_KEY not configured',
		};
	}

	const client = new GoogleGenerativeAI(apiKey);
	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const modelCandidates = configuredModel
		? [configuredModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== configuredModel)]
		: [...DEFAULT_MODEL_CANDIDATES];

	let text = '';
	let lastError: unknown = null;

	for (const modelName of modelCandidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
			const result = await model.generateContent(fullPrompt);
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

export async function parseCommandWithGemini(
	command: string,
	active: ActiveWorkspace = { document: null, spreadsheet: null, presentation: null },
): Promise<ParseResult> {
	const contextBlock = formatActiveWorkspaceContext(active);
	const prompt = `${commandParserPrompt}${contextBlock}\n\nUser command:\n${command}`;
	return generateParsedActionFromPrompt(prompt);
}

/**
 * Docs-specific parse: fetches the live document body, injects structured context so Gemini can
 * resolve find_text / section_heading against real headings and indices. Falls back to the generic
 * parser if no active doc or if the Docs API fetch fails.
 */
export async function parseDocsCommandWithContext(
	command: string,
	active: ActiveWorkspace,
	oauthClient: unknown,
): Promise<ParseResult> {
	if (!active.document) return parseCommandWithGemini(command, active);
	try {
		const docs = google.docs({ version: 'v1', auth: oauthClient as any });
		const res = await docs.documents.get({ documentId: active.document.id });
		const extracted = extractDocumentContext(res.data.body as { content?: unknown[] }, active.document.title);

		const docBlock = [
			'The following is the live structure of the active document with exact text and API indices.',
			'Before filling any field, read this structure and resolve every user reference against it.',
			'"The title" = the TITLE paragraph text.',
			'"The summary section" = the HEADING whose quoted text contains "Summary" — use delete_section with that exact heading text, not delete_text.',
			'"Bold the Biology header" = style_text with find_text set to the exact HEADING text containing "Biology".',
			'Never guess. find_text must be verbatim text that appears in the structure below.',
			'',
			'--- ACTIVE GOOGLE DOC BODY ---',
			extracted.contextString,
			'--- END DOCUMENT ---',
		].join('\n');

		const contextBlock = formatActiveWorkspaceContext(active);
		const fullPrompt = `${commandParserPrompt}\n${docBlock}${contextBlock}\n\nUser command:\n${command}`;
		return generateParsedActionFromPrompt(fullPrompt);
	} catch (error) {
		console.error('[gemini] parseDocsCommandWithContext: document fetch failed, fallback:', error);
		return parseCommandWithGemini(command, active);
	}
}

const VALID_APP_NAMES: AppName[] = ['docs', 'sheets', 'slides', 'gmail', 'forms', 'drive', 'calendar'];

export async function routeToApp(command: string): Promise<AppName | null> {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;

	const client = new GoogleGenerativeAI(apiKey);
	const prompt = `${appRouterPrompt}${command}`;

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
