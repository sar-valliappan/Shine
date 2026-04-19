import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateDraftRequest {
  to?: string;
  subject?: string;
  body?: string;
}

interface SendEmailRequest {
  to?: string;
  subject?: string;
  body?: string;
}

interface GmailDraftSummary {
  id: string;
  to: string;
  subject: string;
  snippet: string;
}

interface GmailDraftDetail {
  id: string;
  to: string;
  subject: string;
  body: string;
  snippet: string;
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

function getHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | null | undefined, key: string): string {
  if (!headers) return '';
  const match = headers.find((h) => (h.name || '').toLowerCase() === key.toLowerCase());
  return match?.value || '';
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf-8');
}

function parseRawEmailMessage(raw: string): { to: string; subject: string; body: string } {
  const decoded = decodeBase64Url(raw);
  const lines = decoded.split(/\r?\n/);
  let i = 0;
  let to = '';
  let subject = '';

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      break;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'to') to = val;
    if (key === 'subject') subject = val;
  }

  const body = lines.slice(i).join('\n');
  return { to, subject, body };
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

/**
 * POST /api/gmail/send
 * Sends an email via Gmail
 */
router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body as SendEmailRequest;

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

    // Send email
    const sendResponse = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encoded,
      },
    });

    const messageId = sendResponse.data.id;

    if (!messageId) {
      return res.status(500).json({ error: 'Failed to send email' });
    }

    res.json({
      action: 'send_email',
      title: subject.trim(),
      url: `https://mail.google.com/mail/#search/${encodeURIComponent(to.trim())}`,
      fileType: 'gmail',
      summary: `Email sent to ${to.trim()}: ${subject.trim()}`,
    });
  } catch (error) {
    console.error('Error sending email:', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/gmail/overview
 * Returns live Gmail data for right-pane rendering (drafts only)
 */
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });

    const draftList = await gmail.users.drafts.list({ userId: 'me', maxResults: 8 });

    const draftIds = (draftList.data.drafts || []).map((d) => d.id).filter((id): id is string => !!id);

    const draftDetails = await Promise.all(
      draftIds.map((id) =>
        gmail.users.drafts.get({
          userId: 'me',
          id,
          format: 'full',
        })
      )
    );

    const drafts: GmailDraftSummary[] = draftDetails.map((response) => {
      const draft = response.data;
      const headers = draft.message?.payload?.headers;
      return {
        id: draft.id || '',
        to: getHeaderValue(headers, 'To') || '(no recipient)',
        subject: getHeaderValue(headers, 'Subject') || '(no subject)',
        snippet: draft.message?.snippet || '',
      };
    });

    res.json({
      drafts,
      summary: `Loaded ${drafts.length} drafts`,
    });
  } catch (error) {
    console.error('Error loading Gmail overview:', error);
    const message = error instanceof Error ? error.message : 'Failed to load Gmail overview';
    if (/insufficient permission|insufficientpermissions|request had insufficient authentication scopes/i.test(message)) {
      return res.status(403).json({
        error: 'Missing Gmail compose permission. Run login again to grant updated Gmail scopes.',
      });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/gmail/drafts/:id
 * Returns a specific Gmail draft so it can be live-edited in the UI
 */
router.get('/drafts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id;
    if (!draftId) return res.status(400).json({ error: 'Missing draft id' });

    const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });
    const response = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'raw' });
    const draft = response.data;
    const raw = draft.message?.raw;
    if (!raw) return res.status(404).json({ error: 'Draft not found or missing raw content' });

    const parsed = parseRawEmailMessage(raw);
    const result: GmailDraftDetail = {
      id: draft.id || draftId,
      to: parsed.to,
      subject: parsed.subject,
      body: parsed.body,
      snippet: draft.message?.snippet || '',
    };

    res.json(result);
  } catch (error) {
    console.error('Error loading Gmail draft:', error);
    const message = error instanceof Error ? error.message : 'Failed to load draft';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/gmail/drafts/:id
 * Updates an existing Gmail draft with latest compose fields
 */
router.put('/drafts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id;
    if (!draftId) return res.status(400).json({ error: 'Missing draft id' });

    const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
    if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
      return res.status(400).json({ error: 'to, subject, and body must be strings' });
    }

    const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });
    const rawMessage = createEmailMessage(to, subject, body);
    const encoded = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const updateResponse = await gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: {
        id: draftId,
        message: {
          raw: encoded,
        },
      },
    });

    const updatedId = updateResponse.data.id || draftId;
    res.json({
      id: updatedId,
      url: `https://mail.google.com/mail/#drafts/${updatedId}`,
      summary: 'Draft updated',
    });
  } catch (error) {
    console.error('Error updating Gmail draft:', error);
    const message = error instanceof Error ? error.message : 'Failed to update draft';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/gmail/drafts/:id/send
 * Sends an existing Gmail draft
 */
router.post('/drafts/:id/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id;
    if (!draftId) return res.status(400).json({ error: 'Missing draft id' });

    const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });
    const sendResponse = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: {
        id: draftId,
      },
    });

    const messageId = sendResponse.data.id || '';
    res.json({
      id: draftId,
      messageId,
      summary: 'Draft sent',
    });
  } catch (error) {
    console.error('Error sending Gmail draft:', error);
    const message = error instanceof Error ? error.message : 'Failed to send draft';
    res.status(500).json({ error: message });
  }
});

export default router;
