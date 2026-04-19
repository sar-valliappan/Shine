import { GoogleGenerativeAI } from '@google/generative-ai';
import { commandParserPrompt } from '../prompts/commandParser.js';
import type { ParseResult, WorkspaceAction } from '../types/actions.js';

const DEFAULT_MODEL_CANDIDATES = [
	'gemini-2.5-flash-lite',
	'gemini-2.0-flash',
	'gemini-1.5-flash',
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

export async function parseCommandWithGemini(command: string): Promise<ParseResult> {
	const apiKey = process.env.GEMINI_API_KEY;

	if (!apiKey) {
		return {
			action: { action: 'clarify', question: 'The AI service is not configured. Please contact support.' },
			rawText: 'GEMINI_API_KEY not configured',
		};
	}

	const client = new GoogleGenerativeAI(apiKey);
	const prompt = `${commandParserPrompt}\n\nUser command:\n${command}`;

	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const modelCandidates = configuredModel
		? [configuredModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== configuredModel)]
		: [...DEFAULT_MODEL_CANDIDATES];

	let text = '';
	let lastError: unknown = null;

	for (const modelName of modelCandidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName });
			const result = await model.generateContent(prompt);
			text = result.response.text();
			lastError = null;
			break;
		} catch (error) {
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
