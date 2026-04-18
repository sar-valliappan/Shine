import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateDraftRequest {
  to?: string;
  subject?: string;
  body?: string;
}

/**
 * Helper function to create RFC 2822 formatted email message
 */
function createEmailMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  return lines.join('\n');
}

/**
 * POST /api/gmail/draft
 * Creates a Gmail draft with the provided recipient, subject, and body
 */
router.post('/draft', requireAuth, async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body as CreateDraftRequest;

    // Validate input
    if (!to || typeof to !== 'string' || !to.trim()) {
      return res.status(400).json({ error: 'Missing or invalid "to" email address' });
    }

    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Missing or invalid subject' });
    }

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'Missing or invalid body' });
    }

    // Validate email format (basic check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to.trim())) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });

    // Create RFC 2822 formatted message
    const message = createEmailMessage(to.trim(), subject.trim(), body.trim());

    // Encode to base64url
    const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    // Create draft
    const draftResponse = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: encoded,
        },
      },
    });

    const draftId = draftResponse.data.id;

    if (!draftId) {
      return res.status(500).json({ error: 'Failed to create Gmail draft' });
    }

    const url = `https://mail.google.com/mail/#drafts/${draftId}`;

    res.json({
      action: 'create_draft',
      title: subject.trim(),
      url,
      fileType: 'gmail',
      summary: `Draft email to ${to.trim()}: ${subject.trim()}`,
    });
  } catch (error) {
    console.error('Error creating Gmail draft:', error);
    const message = error instanceof Error ? error.message : 'Failed to create draft';
    res.status(500).json({ error: message });
  }
});

export default router;
