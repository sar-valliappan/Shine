import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateSlidesRequest {
  title?: string;
  slide_prompts?: string[];
}

/**
 * POST /api/slides/create
 * Creates a Google Slides presentation with provided slide outlines
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, slide_prompts } = req.body as CreateSlidesRequest;

    // Validate input
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Missing or invalid title' });
    }

    if (!Array.isArray(slide_prompts) || slide_prompts.length === 0) {
      return res.status(400).json({ error: 'slide_prompts must be a non-empty array' });
    }

    // Create Google Slides API client
    const slides = google.slides({ version: 'v1', auth: req.oauthClient });
    const drive = google.drive({ version: 'v3', auth: req.oauthClient });

    // Create a new presentation
    const createResponse = await slides.presentations.create({
      requestBody: {
        title: title.trim(),
      },
    });

    const presentationId = createResponse.data.presentationId;

    if (!presentationId) {
      return res.status(500).json({ error: 'Failed to create presentation' });
    }

    // Build requests to add slides with text
    const requests: any[] = [];

    // Add slides for each prompt (starting after the blank first slide)
    for (let i = 0; i < slide_prompts.length; i++) {
      const slideIndex = i + 1;

      if (i === 0) {
        // Use the existing blank slide for the first slide
        requests.push(
          {
            insertText: {
              objectId: 'slide1_title',
              text: slide_prompts[i],
              insertionIndex: 0,
            },
          },
          {
            updateTextStyle: {
              objectId: 'slide1_title',
              style: {
                fontSize: { magnitude: 44, unit: 'PT' },
              },
              fields: 'fontSize',
            },
          }
        );
      } else {
        // Add new slides
        requests.push({
          createSlide: {
            objectId: `slide${slideIndex}`,
            insertionIndex: slideIndex,
            slideLayout: 'TITLE_AND_BODY',
          },
        });

        requests.push({
          insertText: {
            objectId: `slide${slideIndex}_title`,
            text: slide_prompts[i],
            insertionIndex: 0,
          },
        });
      }
    }

    // Apply all requests
    if (requests.length > 0) {
      await slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      });
    }

    const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;

    res.json({
      action: 'create_presentation',
      title: title.trim(),
      url,
      fileType: 'slides',
      summary: `Created Google Slides presentation: ${title.trim()} with ${slide_prompts.length} slides`,
    });
  } catch (error) {
    console.error('Error creating Google Slides presentation:', error);
    const message = error instanceof Error ? error.message : 'Failed to create presentation';
    res.status(500).json({ error: message });
  }
});

export default router;
