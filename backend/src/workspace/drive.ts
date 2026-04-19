import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseCommandWithGemini } from '../services/gemini.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';
import { enrichDriveFile } from './drivePreview.js';
import { driveCommandParserPrompt } from '../prompts/driveCommandParser.js';

function escapeDriveQuery(value: string): string {
	return value.replace(/'/g, "\\'");
}

type DriveLookupHint = {
	intent: 'open' | 'search' | 'list' | 'share' | 'clarify';
	query: string;
	kind?: 'doc' | 'sheet' | 'slides' | 'form' | 'drive';
	message?: string;
};

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

function parseDriveLookupJson(text: string): DriveLookupHint {
	const cleaned = text
		.trim()
		.replace(/^```json\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/```\s*$/i, '');

	const jsonPayload = cleaned.startsWith('{') ? cleaned : extractFirstJsonObject(cleaned);
	const parsed = JSON.parse(jsonPayload) as DriveLookupHint;
	if (!parsed || typeof parsed !== 'object' || !('intent' in parsed)) {
		throw new Error('Gemini response missing intent field');
	}
	return parsed;
}

function toWorkspaceFileType(kind: DriveLookupHint['kind']): 'doc' | 'sheet' | 'slides' | 'form' | 'list' {
	if (kind === 'doc') return 'doc';
	if (kind === 'sheet') return 'sheet';
	if (kind === 'slides') return 'slides';
	if (kind === 'form') return 'form';
	return 'list';
}

export async function lookupDriveFilesByName(
	command: string,
	oauthClient: unknown,
	apiKey?: string,
	): Promise<ParseRouteResult | null> {
	const key = apiKey ?? process.env.GEMINI_API_KEY;
	if (!key) return null;

	const client = new GoogleGenerativeAI(key);
	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const modelCandidates = configuredModel
		? [configuredModel, 'gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it'].filter((model, index, values) => values.indexOf(model) === index)
		: ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it'];

	let lookup: DriveLookupHint | null = null;
	for (const modelName of modelCandidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
			const result = await model.generateContent(`${driveCommandParserPrompt}\n\nUser command:\n${command}`);
			lookup = parseDriveLookupJson(result.response.text());
			break;
		} catch (error) {
			console.error(`[drive:gemini] Model failed: ${modelName}`, error);
		}
	}

	if (!lookup || lookup.intent === 'clarify') return null;

	const drive = google.drive({ version: 'v3', auth: oauthClient as any });
	const mimeTypeFilter =
		lookup.kind === 'doc' ? " and mimeType contains 'document'"
		: lookup.kind === 'sheet' ? " and mimeType contains 'spreadsheet'"
		: lookup.kind === 'slides' ? " and mimeType contains 'presentation'"
		: lookup.kind === 'form' ? " and mimeType contains 'form'"
		: '';

	const result = await drive.files.list({
		q: `trashed = false and (name contains '${escapeDriveQuery(lookup.query)}' or fullText contains '${escapeDriveQuery(lookup.query)}')${mimeTypeFilter}`,
		pageSize: 10,
		fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
		orderBy: 'modifiedTime desc',
	});

	const normalizedQuery = lookup.query.toLowerCase();
	const items = (result.data.files ?? [])
		.map((file) => enrichDriveFile(file))
		.sort((a, b) => {
			const aName = (a.name || '').toLowerCase();
			const bName = (b.name || '').toLowerCase();
			const aScore = aName === normalizedQuery ? 2 : aName.includes(normalizedQuery) ? 1 : 0;
			const bScore = bName === normalizedQuery ? 2 : bName.includes(normalizedQuery) ? 1 : 0;
			if (aScore !== bScore) return bScore - aScore;
			return (b.modifiedTime || '').localeCompare(a.modifiedTime || '');
		});

	const topItem = items[0];
	if (topItem && lookup.intent === 'open' && lookup.kind !== 'drive') {
		return {
			action: lookup.kind === 'doc' ? 'open_document' : lookup.kind === 'sheet' ? 'open_spreadsheet' : lookup.kind === 'slides' ? 'open_presentation' : 'open_form',
			title: topItem.name ?? lookup.query,
			url: topItem.webViewLink ?? topItem.embedUrl,
			embedUrl: topItem.embedUrl,
			fileType: toWorkspaceFileType(lookup.kind),
			summary: `Opened ${topItem.name ?? lookup.query}`,
			items: [],
		};
	}

	if (lookup.intent === 'share') return null;

	return {
		action: lookup.intent === 'list' ? 'list_files' : 'search_drive',
		title: items.length ? `Drive results for ${lookup.query}` : `No Drive files found for ${lookup.query}`,
		fileType: 'list',
		items,
		summary: items.length ? `Found ${items.length} files` : `No Drive files found for ${lookup.query}`,
	};
}

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
	const explicitLookup = await lookupDriveFilesByName(command, oauthClient, apiKey);
	if (explicitLookup) return explicitLookup;

	const parsed = await parseCommandWithGemini(command, active);
	return executeWorkspaceAction(parsed.action, oauthClient, apiKey);
}
