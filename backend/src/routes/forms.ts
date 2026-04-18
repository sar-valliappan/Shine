import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface Question {
  title?: string;
  type?: 'TEXT' | 'MULTIPLE_CHOICE';
  options?: string[];
}

interface CreateFormRequest {
  title?: string;
  questions?: Question[];
}

/**
 * POST /api/forms/create
 * Creates a Google Form for surveys or data collection
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, questions } = req.body as CreateFormRequest;

    // Validate input
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Missing or invalid title' });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'questions must be a non-empty array' });
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.title || typeof q.title !== 'string' || !q.title.trim()) {
        return res.status(400).json({ error: `Question ${i + 1}: missing or invalid title` });
      }
      if (!q.type || !['TEXT', 'MULTIPLE_CHOICE'].includes(q.type)) {
        return res.status(400).json({ error: `Question ${i + 1}: type must be TEXT or MULTIPLE_CHOICE` });
      }
      if (q.type === 'MULTIPLE_CHOICE' && (!Array.isArray(q.options) || q.options.length === 0)) {
        return res.status(400).json({ error: `Question ${i + 1}: MULTIPLE_CHOICE requires non-empty options array` });
      }
    }

    // Create Google Forms API client
    const forms = google.forms({ version: 'v1', auth: req.oauthClient });

    // Create new form
    const createResponse = await forms.forms.create({
      requestBody: {
        info: {
          title: title.trim(),
        },
      },
    });

    const formId = createResponse.data.formId;

    if (!formId) {
      return res.status(500).json({ error: 'Failed to create form' });
    }

    // Build requests to add questions
    const requests: any[] = [];

    for (const question of questions) {
      const item: any = {
        title: question.title!.trim(),
      };

      if (question.type === 'TEXT') {
        item.questionItem = {
          question: {
            required: true,
            textQuestion: {
              paragraph: false,
            },
          },
        };
      } else if (question.type === 'MULTIPLE_CHOICE') {
        item.questionItem = {
          question: {
            required: true,
            choiceQuestion: {
              type: 'RADIO',
              options: (question.options || []).map((opt) => ({ value: opt })),
            },
          },
        };
      }

      requests.push({
        createItem: {
          item,
          location: { index: requests.length },
        },
      });
    }

    // Add all questions to the form
    if (requests.length > 0) {
      await forms.forms.batchUpdate({
        formId,
        requestBody: { requests },
      });
    }

    const url = `https://docs.google.com/forms/d/${formId}/edit`;

    res.json({
      action: 'create_form',
      title: title.trim(),
      url,
      fileType: 'form',
      summary: `Created Google Form: ${title.trim()} with ${questions.length} questions`,
    });
  } catch (error) {
    console.error('Error creating Google Form:', error);
    const message = error instanceof Error ? error.message : 'Failed to create form';
    res.status(500).json({ error: message });
  }
});

export default router;
