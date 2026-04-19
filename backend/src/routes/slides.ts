import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  createStyledPresentation,
  addSlide,
  editSlide,
  deleteSlide,
} from '../services/slidesService.js';

const router = Router();

router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, slide_prompts } = req.body as {
      title?: string;
      slide_prompts?: string[];
    };

    if (!title?.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(slide_prompts) || slide_prompts.length === 0) {
      return res.status(400).json({ error: 'slide_prompts must be a non-empty array' });
    }

    const { presentationId, url, slideCount } = await createStyledPresentation(
      title.trim(),
      slide_prompts,
      req.oauthClient,
      process.env.GEMINI_API_KEY,
    );

    return res.json({
      action: 'create_presentation',
      title: title.trim(),
      url,
      fileType: 'slides',
      presentationId,
      summary: `Created "${title.trim()}" — ${slideCount} slides`,
    });
  } catch (error) {
    console.error('slides/create error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create presentation',
    });
  }
});

router.post('/edit', requireAuth, async (req: Request, res: Response) => {
  try {
    const { presentationId, operation, slide_prompt, slide_index, title, body } = req.body as {
      presentationId?: string;
      operation?: string;
      slide_prompt?: string;
      slide_index?: number;
      title?: string;
      body?: string;
    };

    if (!presentationId) {
      return res.status(400).json({ error: 'presentationId is required' });
    }

    const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;

    if (operation === 'add_slide') {
      const { title: newTitle } = await addSlide(
        presentationId,
        slide_prompt ?? 'New slide',
        req.oauthClient,
        process.env.GEMINI_API_KEY,
      );
      return res.json({
        action: 'edit_presentation',
        operation: 'add_slide',
        title: newTitle,
        url,
        fileType: 'slides',
        summary: `Added slide: "${newTitle}"`,
      });
    }

    if (operation === 'edit_slide') {
      const idx = typeof slide_index === 'number' ? slide_index : 0;
      await editSlide(presentationId, idx, { title, body }, req.oauthClient);
      return res.json({
        action: 'edit_presentation',
        operation: 'edit_slide',
        title: title ?? `Slide ${idx + 1}`,
        url,
        fileType: 'slides',
        summary: `Updated slide ${idx + 1}`,
      });
    }

    if (operation === 'delete_slide') {
      const idx = typeof slide_index === 'number' ? slide_index : 0;
      await deleteSlide(presentationId, idx, req.oauthClient);
      return res.json({
        action: 'edit_presentation',
        operation: 'delete_slide',
        title: `Slide ${idx + 1} deleted`,
        url,
        fileType: 'slides',
        summary: `Deleted slide ${idx + 1}`,
      });
    }

    return res.status(400).json({ error: `Unknown operation: ${operation}` });
  } catch (error) {
    console.error('slides/edit error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to edit presentation',
    });
  }
});

export default router;
