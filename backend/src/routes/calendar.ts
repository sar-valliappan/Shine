import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateEventRequest {
  summary?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
}

/**
 * POST /api/calendar/create
 * Creates a new event on Google Calendar
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { summary, start_time, end_time, location, description } = req.body as CreateEventRequest;

    // Validate input
    if (!summary || typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ error: 'Missing or invalid summary' });
    }

    if (!start_time || typeof start_time !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid start_time (ISO 8601 format required)' });
    }

    if (!end_time || typeof end_time !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid end_time (ISO 8601 format required)' });
    }

    // Validate ISO 8601 date format
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_time is not a valid ISO 8601 date-time' });
    }

    if (isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'end_time is not a valid ISO 8601 date-time' });
    }

    if (endDate <= startDate) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    // Create Google Calendar API client
    const calendar = google.calendar({ version: 'v3', auth: req.oauthClient });

    // Create the event
    const eventResponse = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: summary.trim(),
        description: description ? description.trim() : undefined,
        location: location ? location.trim() : undefined,
        start: {
          dateTime: startDate.toISOString(),
        },
        end: {
          dateTime: endDate.toISOString(),
        },
      },
    });

    const eventId = eventResponse.data.id;
    const eventUrl = eventResponse.data.htmlLink;

    if (!eventId) {
      return res.status(500).json({ error: 'Failed to create calendar event' });
    }

    res.json({
      action: 'create_event',
      title: summary.trim(),
      url: eventUrl,
      fileType: 'calendar',
      summary: `Created calendar event: ${summary.trim()} on ${startDate.toLocaleDateString()}`,
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    const message = error instanceof Error ? error.message : 'Failed to create event';
    res.status(500).json({ error: message });
  }
});

export default router;
