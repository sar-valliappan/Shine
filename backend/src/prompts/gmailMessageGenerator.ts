import { GoogleGenerativeAI } from '@google/generative-ai';

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

		const revisionInstruction = `You are revising an existing email draft.

Subject: ${subject}
Current body:
${currentBody || '(empty)'}

Requested changes:
${editRequest}

Requirements:
- Return ONLY the revised email body text (no subject line, no markdown, no code fences).
- Apply the requested changes directly to the current body.
- Keep sender intent, facts, and recipient context unless user asked to change them.
- Ensure the revised body is not identical to the current body.
- End the final line with exactly: "${SHINE_SIGNATURE}"`;

		const first = await model.generateContent(revisionInstruction);
		let revised = withShineSignature(stripCodeFences(first.response.text()) || fallback);

		if (normalizeForComparison(revised) === normalizeForComparison(currentWithSignature)) {
			const enforceInstruction = `${revisionInstruction}\n\nThe prior output was too similar. Rewrite more clearly so wording changes are obvious while preserving meaning.`;
			const second = await model.generateContent(enforceInstruction);
			revised = withShineSignature(stripCodeFences(second.response.text()) || fallback);
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
