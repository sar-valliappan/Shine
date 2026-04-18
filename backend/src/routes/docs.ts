import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateDocRequest {
  title?: string;
  content?: string;
}

/**
 * POST /api/docs/create
 * Creates a new Google Doc with the provided title and content
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, content } = req.body as CreateDocRequest;

    // Validate input
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Missing or invalid title' });
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Missing or invalid content' });
    }

    // Create Google Docs API client
    const docs = google.docs({ version: 'v1', auth: req.oauthClient });

    // Create a new document
    const createResponse = await docs.documents.create({
      requestBody: {
        title: title.trim(),
      },
    });

    const documentId = createResponse.data.documentId;

    if (!documentId) {
      return res.status(500).json({ error: 'Failed to create document in Google Drive' });
    }

    // Insert content into the document
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: content.trim(),
            },
          },
        ],
      },
    });

    const url = `https://docs.google.com/document/d/${documentId}/edit`;

    res.json({
      action: 'create_document',
      title: title.trim(),
      url,
      fileType: 'doc',
      summary: `Created Google Doc: ${title.trim()}`,
    });
  } catch (error) {
    console.error('Error creating Google Doc:', error);
    const message = error instanceof Error ? error.message : 'Failed to create document';
    res.status(500).json({ error: message });
  }
});

export default router;
