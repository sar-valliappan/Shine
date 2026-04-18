import { GoogleGenerativeAI } from '@google/generative-ai';
import { commandParserPrompt } from '../prompts/commandParser.js';
import type { ParseResult, WorkspaceAction } from '../types/actions.js';

const DEFAULT_MODEL_CANDIDATES = [
	'gemini-2.0-flash',
	'gemini-1.5-flash-latest',
	'gemini-1.5-pro-latest',
] as const;

function extractFirstJsonObject(text: string): string {
	const start = text.indexOf('{');
	if (start === -1) {
		throw new Error('No JSON object found in response');
	}

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i += 1) {
		const char = text[i];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (char === '\\') {
			escaped = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (inString) {
			continue;
		}

		if (char === '{') {
			depth += 1;
		}

		if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}

	throw new Error('Unbalanced JSON object in response');
}

function parseJsonPayload(text: string): WorkspaceAction {
	const trimmed = text.trim();
	const cleaned = trimmed
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

function parseQuotedTitle(command: string): string | null {
	const quoted = command.match(/["']([^"']{2,120})["']/);
	if (quoted?.[1]) return quoted[1].trim();
	return null;
}

function parseTitleAfterKeyword(command: string, keyword: RegExp): string | null {
	const match = command.match(keyword);
	if (!match?.[1]) return null;
	const value = match[1].trim().replace(/[.!,;:]$/, '');
	return value.length > 1 ? value : null;
}

function inferTitle(command: string, fallbackPrefix: string): string {
	return (
		parseQuotedTitle(command) ??
		parseTitleAfterKeyword(command, /(?:called|named|titled)\s+(.+)$/i) ??
		`${fallbackPrefix} ${new Date().toISOString().slice(0, 10)}`
	);
}

function extractEmail(command: string): string | null {
	const match = command.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
	return match?.[0]?.trim() ?? null;
}

function extractFieldAfterKeyword(command: string, keyword: RegExp): string | null {
	const match = command.match(keyword);
	if (!match?.[1]) return null;
	const value = match[1].trim();
	return value.length > 0 ? value : null;
}

function inferEventTimes(command: string): { start: string; end: string } {
	const now = new Date();
	const start = new Date(now);

	if (/tomorrow/i.test(command)) {
		start.setDate(start.getDate() + 1);
	}

	const timeMatch = command.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
	if (timeMatch) {
		let hour = Number.parseInt(timeMatch[1], 10);
		const minute = Number.parseInt(timeMatch[2] ?? '0', 10);
		const meridiem = timeMatch[3]?.toLowerCase();

		if (meridiem === 'pm' && hour < 12) hour += 12;
		if (meridiem === 'am' && hour === 12) hour = 0;

		start.setHours(hour, minute, 0, 0);
	} else {
		start.setHours(start.getHours() + 1, 0, 0, 0);
	}

	const end = new Date(start);
	end.setHours(end.getHours() + 1);

	return { start: start.toISOString(), end: end.toISOString() };
}

function fallbackAction(command: string): WorkspaceAction {
	const lower = command.toLowerCase();
	const normalized = command.trim();

	if (/(create|make|write|draft)\b/.test(lower) && /(doc|document|google doc)\b/.test(lower)) {
		const title = inferTitle(normalized, 'Untitled Document');
		return {
			action: 'create_document',
			title,
			content_prompt: `Draft the requested content for "${title}" based on the command: ${normalized}`,
		};
	}

	if (/(create|make|build)\b/.test(lower) && /(sheet|spreadsheet)\b/.test(lower)) {
		const title = inferTitle(normalized, 'Untitled Spreadsheet');
		return {
			action: 'create_spreadsheet',
			title,
			headers: ['Task', 'Owner', 'Status'],
			rows: [],
		};
	}

	if (/(create|make|build)\b/.test(lower) && /(slides|presentation|deck)\b/.test(lower)) {
		const title = inferTitle(normalized, 'Untitled Presentation');
		return {
			action: 'create_presentation',
			title,
			slide_prompts: ['Title slide', 'Key points', 'Next steps'],
		};
	}

	if (/(create|make|build)\b/.test(lower) && /(form|survey|quiz)\b/.test(lower)) {
		const title = inferTitle(normalized, 'Untitled Form');
		return {
			action: 'create_form',
			title,
			questions: [{ title: 'What feedback would you like to share?', type: 'TEXT' }],
		};
	}

	if (/(create|schedule|book)\b/.test(lower) && /(event|meeting|calendar)\b/.test(lower)) {
		const summary = inferTitle(normalized, 'New Event');
		const times = inferEventTimes(normalized);
		return {
			action: 'create_event',
			summary,
			start_time: times.start,
			end_time: times.end,
		};
	}

	if (lower.includes('send') && lower.includes('email')) {
		const to = extractEmail(normalized);
		const subject =
			extractFieldAfterKeyword(normalized, /subject\s*(?:is|:)?\s*([^\n]+?)(?:\s+body\s*(?:is|:)?\s*|$)/i) ??
			inferTitle(normalized, 'Quick update');
		const body = extractFieldAfterKeyword(normalized, /body\s*(?:is|:)?\s*([\s\S]+)$/i);

		if (to && body) {
			return { action: 'send_email', to, subject, body_prompt: body };
		}

		return {
			action: 'clarify',
			question: 'Who should receive the email, and what subject/body should I send?',
		};
	}

	if (lower.includes('draft') && lower.includes('email')) {
		const to = extractEmail(normalized);
		const subject =
			extractFieldAfterKeyword(normalized, /subject\s*(?:is|:)?\s*([^\n]+?)(?:\s+body\s*(?:is|:)?\s*|$)/i) ??
			inferTitle(normalized, 'Draft email');
		const body = extractFieldAfterKeyword(normalized, /body\s*(?:is|:)?\s*([\s\S]+)$/i);

		if (to && body) {
			return { action: 'create_draft', to, subject, body_prompt: body };
		}

		return {
			action: 'clarify',
			question: 'Who should receive the draft and what should the subject/body be?',
		};
	}

	if (/(list|show|open)\b/.test(lower) && /(drive|files?)\b/.test(lower)) {
		return { action: 'list_files', limit: 10 };
	}

	if (/(search|find|look for)\b/.test(lower) && /(drive|files?|docs?)\b/.test(lower)) {
		const query =
			extractFieldAfterKeyword(normalized, /(?:for|about|named)\s+(.+)$/i) ??
			parseQuotedTitle(normalized);

		if (query) {
			return { action: 'search_drive', query };
		}

		return {
			action: 'clarify',
			question: 'What should I search for in Drive?',
		};
	}

	return {
		action: 'clarify',
		question: 'I could not confidently parse that. Can you rephrase the command?',
	};
}

export async function parseCommandWithGemini(command: string): Promise<ParseResult> {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return { action: fallbackAction(command), rawText: 'GEMINI_API_KEY not configured' };
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

	if (!text && lastError) {
		return {
			action: fallbackAction(command),
			rawText: `Gemini request failed: ${String(lastError)}`,
		};
	}

	try {
		const action = parseJsonPayload(text);
		return { action, rawText: text };
	} catch (error) {
		return {
			action: fallbackAction(command),
			rawText: text,
		};
	}
}
