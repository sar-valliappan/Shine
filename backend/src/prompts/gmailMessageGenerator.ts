import { GoogleGenerativeAI } from '@google/generative-ai';
import { MINIMAL_EDIT_GUIDANCE } from './editingGuidance.js';

const SHINE_SIGNATURE = 'Sent with Shine';

function stripCodeFences(text: string): string {
	return text
		.trim()
		.replace(/^```[a-zA-Z]*\n?/i, '')
		.replace(/```\s*$/i, '')
		.trim();
}

function withShineSignature(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) return SHINE_SIGNATURE;
	if (trimmed.toLowerCase().endsWith(SHINE_SIGNATURE.toLowerCase())) return trimmed;
	return `${trimmed}\n\n${SHINE_SIGNATURE}`;
}

function normalizeForComparison(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function splitParagraphs(text: string): string[] {
	return text
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function extractFirstJsonObject(text: string): string {
	const start = text.indexOf('{');
	if (start === -1) throw new Error('No JSON object found in response');

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
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
		if (inString) continue;
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return text.slice(start, index + 1);
		}
	}

	throw new Error('Unbalanced JSON object in response');
}

type ParagraphEditPlan = {
	replace?: Array<{ index: number; text: string }>;
	insertAfter?: Array<{ index: number; text: string }>;
	delete?: number[];
};

function parseParagraphEditPlan(text: string): ParagraphEditPlan {
	const cleaned = stripCodeFences(text);
	const payload = cleaned.startsWith('{') ? cleaned : extractFirstJsonObject(cleaned);
	const parsed = JSON.parse(payload) as ParagraphEditPlan;
	return {
		replace: Array.isArray(parsed.replace) ? parsed.replace : [],
		insertAfter: Array.isArray(parsed.insertAfter) ? parsed.insertAfter : [],
		delete: Array.isArray(parsed.delete) ? parsed.delete : [],
	};
}

function applyParagraphEditPlan(currentBody: string, plan: ParagraphEditPlan): string {
	const paragraphs = splitParagraphs(currentBody);
	const hasSignature = normalizeForComparison(paragraphs.at(-1) ?? '') === normalizeForComparison(SHINE_SIGNATURE);
	const signature = hasSignature ? paragraphs.pop() : '';
	const editableParagraphs = [...paragraphs];

	const deleteIndexes = [...new Set((plan.delete ?? []).filter((value) => Number.isInteger(value)))].sort((a, b) => b - a);
	for (const index of deleteIndexes) {
		if (index >= 0 && index < editableParagraphs.length) {
			editableParagraphs.splice(index, 1);
		}
	}

	for (const update of plan.replace ?? []) {
		if (!Number.isInteger(update.index) || update.index < 0 || update.index >= editableParagraphs.length) continue;
		const replacement = update.text.trim();
		if (replacement) {
			editableParagraphs[update.index] = replacement;
		}
	}

	const inserts = [...(plan.insertAfter ?? [])]
		.filter((entry) => Number.isInteger(entry.index))
		.sort((a, b) => a.index - b.index);
	let offset = 0;
	for (const insert of inserts) {
		const text = insert.text.trim();
		if (!text) continue;
		const insertionIndex = Math.min(Math.max(insert.index + 1 + offset, 0), editableParagraphs.length);
		editableParagraphs.splice(insertionIndex, 0, text);
		offset += 1;
	}

	const rebuilt = editableParagraphs.join('\n\n').trim();
	if (signature) {
		return rebuilt ? `${rebuilt}\n\n${signature}` : signature;
	}
	return rebuilt;
}

function applyDeterministicEditFallback(currentBody: string, editRequest: string): string {
	const current = currentBody.trim();
	const request = editRequest.trim();
	if (!request && current) return current;

	const lowered = request.toLowerCase();
	if (current && /\b(shorter|concise|brief|trim)\b/.test(lowered)) {
		const sentences = current.split(/(?<=[.!?])\s+/).filter(Boolean);
		if (sentences.length > 1) {
			const targetCount = Math.max(1, Math.floor(sentences.length * 0.6));
			return sentences.slice(0, targetCount).join(' ');
		}
		const words = current.split(/\s+/).filter(Boolean);
		const targetWords = Math.max(8, Math.floor(words.length * 0.65));
		return words.slice(0, targetWords).join(' ');
	}

	if (current) {
		return `${current}\n\nUpdated per request: ${request || 'Refine wording and tone.'}`;
	}

	return request || 'Please update this draft based on the requested changes.';
}

export async function generateEmailBody(
	subject: string,
	bodyPrompt: string,
	apiKey: string | undefined,
): Promise<string> {
	const fallback = withShineSignature(bodyPrompt);
	if (!apiKey) return fallback;

	try {
		const client = new GoogleGenerativeAI(apiKey);
		const model = client.getGenerativeModel(
			{ model: process.env.GEMINI_MODEL ?? 'gemma-3-27b-it' },
			{ apiVersion: 'v1beta' },
		);

		const instruction = `Write a polished plain-text email body.

Subject: ${subject}
Intent: ${bodyPrompt}

Requirements:
- Return ONLY the email body text (no subject line, no markdown, no code fences).
- Keep it concise and professional.
- Include a greeting and sign-off if appropriate.
- End the final line with exactly: "${SHINE_SIGNATURE}"
`;

		const result = await model.generateContent(instruction);
		const text = stripCodeFences(result.response.text());
		return withShineSignature(text || fallback);
	} catch (error) {
		console.error('[generateEmailBody] error:', error);
		return fallback;
	}
}

export async function generateEditedEmailBody(
	subject: string,
	currentBody: string,
	editRequest: string,
	apiKey: string | undefined,
): Promise<string> {
	let fallbackBody = applyDeterministicEditFallback(currentBody, editRequest);
	const currentWithSignature = withShineSignature(currentBody);
	if (normalizeForComparison(withShineSignature(fallbackBody)) === normalizeForComparison(currentWithSignature)) {
		fallbackBody = `${currentBody.trim()}\n\nUpdated per request: ${editRequest.trim() || 'Refine wording and tone.'}`;
	}
	const fallback = withShineSignature(fallbackBody);
	if (!apiKey) return fallback;

	try {
		const client = new GoogleGenerativeAI(apiKey);
		const model = client.getGenerativeModel(
			{ model: process.env.GEMINI_MODEL ?? 'gemma-3-27b-it' },
			{ apiVersion: 'v1beta' },
		);

		const paragraphs = splitParagraphs(currentBody);
		const hasSignature = normalizeForComparison(paragraphs.at(-1) ?? '') === normalizeForComparison(SHINE_SIGNATURE);
		const editableParagraphs = hasSignature ? paragraphs.slice(0, -1) : paragraphs;
		const numberedParagraphs = editableParagraphs.length
			? editableParagraphs.map((paragraph, index) => `[${index}] ${paragraph}`).join('\n\n')
			: '(empty)';

		const revisionInstruction = `You are revising an existing email draft.

Subject: ${subject}
Current body paragraphs:
${numberedParagraphs}

Requested changes:
${editRequest}

Requirements:
- Return ONLY valid JSON (no markdown or code fences).
- Use this shape: { "replace": [{ "index": 0, "text": "updated paragraph" }], "insertAfter": [{ "index": 1, "text": "new paragraph" }], "delete": [2] }
- Only change the smallest paragraph set needed to satisfy the request.
- Keep all untouched paragraphs verbatim and preserve paragraph order.
- Do not rewrite or rephrase the entire email unless the user explicitly asked for a full rewrite.
- Do not change the signature block. The signature is appended automatically.
${MINIMAL_EDIT_GUIDANCE}`;

		const first = await model.generateContent(revisionInstruction);
		let revised = withShineSignature(applyParagraphEditPlan(currentBody, parseParagraphEditPlan(first.response.text())) || fallback);

		if (normalizeForComparison(revised) === normalizeForComparison(currentWithSignature)) {
			const enforceInstruction = `${revisionInstruction}\n\nThe prior output was too similar. Rewrite more clearly so wording changes are obvious while preserving meaning.`;
			const second = await model.generateContent(enforceInstruction);
			revised = withShineSignature(applyParagraphEditPlan(currentBody, parseParagraphEditPlan(second.response.text())) || fallback);
		}

		if (normalizeForComparison(revised) === normalizeForComparison(currentWithSignature)) {
			return fallback;
		}

		return revised;
	} catch (error) {
		console.error('[generateEditedEmailBody] error:', error);
		return fallback;
	}
}
