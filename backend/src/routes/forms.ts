import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { executeFormAction } from '../workspace/forms.js';
import type { FormQuestion } from '../types/actions.js';

const router = Router();

const VALID_TYPES = new Set<FormQuestion['type']>([
	'SHORT_TEXT', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN',
	'LINEAR_SCALE', 'DATE', 'TIME',
]);

interface CreateFormRequest {
	title?: string;
	description?: string;
	questions?: Array<{ title?: string; type?: string; required?: boolean; options?: string[] }>;
}

router.post('/create', requireAuth, async (req: Request, res: Response) => {
	try {
		const { title, description, questions } = req.body as CreateFormRequest;

		if (!title || typeof title !== 'string' || !title.trim()) {
			return res.status(400).json({ error: 'Missing or invalid title' });
		}
		if (!Array.isArray(questions) || questions.length === 0) {
			return res.status(400).json({ error: 'questions must be a non-empty array' });
		}

		const validated: FormQuestion[] = [];
		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			if (!q.title || typeof q.title !== 'string' || !q.title.trim()) {
				return res.status(400).json({ error: `Question ${i + 1}: missing or invalid title` });
			}
			if (!q.type || !VALID_TYPES.has(q.type as FormQuestion['type'])) {
				return res.status(400).json({
					error: `Question ${i + 1}: type must be one of ${[...VALID_TYPES].join(', ')}`,
				});
			}
			if (['MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN'].includes(q.type) && (!Array.isArray(q.options) || q.options.length === 0)) {
				return res.status(400).json({ error: `Question ${i + 1}: ${q.type} requires a non-empty options array` });
			}
			validated.push({ title: q.title.trim(), type: q.type as FormQuestion['type'], required: q.required ?? false, options: q.options });
		}

		const result = await executeFormAction(
			{ action: 'create_form', title: title.trim(), description, questions: validated },
			req.oauthClient,
		);
		return res.json(result);
	} catch (error) {
		console.error('Error creating Google Form:', error);
		const message = error instanceof Error ? error.message : 'Failed to create form';
		return res.status(500).json({ error: message });
	}
});

export default router;
