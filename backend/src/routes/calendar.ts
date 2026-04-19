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

interface UpdateEventRequest {
  summary?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  calendarId?: string;
}

function isoDatePart(input: string): string {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  return new Date(input).toISOString().slice(0, 10).replace(/-/g, '');
}

function addOneDay(dateYmd: string): string {
  const year = Number(dateYmd.slice(0, 4));
  const month = Number(dateYmd.slice(4, 6)) - 1;
  const day = Number(dateYmd.slice(6, 8));
  const next = new Date(Date.UTC(year, month, day + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildCalendarEmbedUrl(calendarId: string, startTimeIso: string, endTimeIso: string, calendarTimeZone?: string): string {
  const startDate = isoDatePart(startTimeIso);
  let endDate = isoDatePart(endTimeIso);
  if (endDate <= startDate) endDate = addOneDay(startDate);

  const params = new URLSearchParams({
    src: calendarId,
    mode: 'AGENDA',
    dates: `${startDate}/${endDate}`,
  });
  if (calendarTimeZone) params.set('ctz', calendarTimeZone);

  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

function normalizeDateTimeInput(input: string): string {
  const trimmed = input.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

function hasExplicitTimeZone(input: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(input);
}

function buildEventTime(input: string, calendarTimeZone: string): { dateTime: string; timeZone?: string } {
  const normalized = normalizeDateTimeInput(input);
  const probe = new Date(normalized);
  if (Number.isNaN(probe.getTime())) {
    throw new Error(`Invalid event date-time: ${input}`);
  }

  if (hasExplicitTimeZone(normalized)) {
    return { dateTime: new Date(normalized).toISOString() };
  }

  return { dateTime: normalized, timeZone: calendarTimeZone };
}

async function getPrimaryCalendarTimeZone(calendar: ReturnType<typeof google.calendar>): Promise<string> {
  try {
    const setting = await calendar.settings.get({ setting: 'timezone' });
    return setting.data.value || 'UTC';
  } catch {
    return 'UTC';
  }
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

    // Validate date-time format and range
    const startDate = new Date(normalizeDateTimeInput(start_time));
    const endDate = new Date(normalizeDateTimeInput(end_time));

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
    const calendarTimeZone = await getPrimaryCalendarTimeZone(calendar);
    const start = buildEventTime(start_time, calendarTimeZone);
    const end = buildEventTime(end_time, calendarTimeZone);

    // Create the event
    const eventResponse = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: summary.trim(),
        description: description ? description.trim() : undefined,
        location: location ? location.trim() : undefined,
        start,
        end,
      },
    });

    const eventId = eventResponse.data.id;
    const eventUrl = eventResponse.data.htmlLink;
    const calendarId = eventResponse.data.organizer?.email || eventResponse.data.creator?.email || 'primary';

    if (!eventId) {
      return res.status(500).json({ error: 'Failed to create calendar event' });
    }

    const createdStart = eventResponse.data.start?.dateTime || start_time;
    const createdEnd = eventResponse.data.end?.dateTime || end_time;

    res.json({
      action: 'create_event',
      title: summary.trim(),
      url: eventUrl,
      embedUrl: buildCalendarEmbedUrl(calendarId, createdStart, createdEnd, calendarTimeZone),
      eventId,
      calendarId,
      start_time: createdStart,
      end_time: createdEnd,
      location: location ? location.trim() : '',
      description: description ? description.trim() : '',
      fileType: 'calendar',
      summary: `Created calendar event: ${summary.trim()} on ${startDate.toLocaleDateString()}`,
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    const message = error instanceof Error ? error.message : 'Failed to create event';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/calendar/events/:eventId
 * Updates an existing Google Calendar event
 */
router.put('/events/:eventId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const {
      summary,
      start_time,
      end_time,
      location,
      description,
      calendarId,
    } = req.body as UpdateEventRequest;

    if (!eventId?.trim()) {
      return res.status(400).json({ error: 'Missing eventId' });
    }
    if (!summary || typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ error: 'Missing or invalid summary' });
    }
    if (!start_time || typeof start_time !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid start_time (ISO 8601 format required)' });
    }
    if (!end_time || typeof end_time !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid end_time (ISO 8601 format required)' });
    }

    const startDate = new Date(normalizeDateTimeInput(start_time));
    const endDate = new Date(normalizeDateTimeInput(end_time));
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_time is not a valid ISO 8601 date-time' });
    }
    if (isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'end_time is not a valid ISO 8601 date-time' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    const resolvedCalendarId = calendarId?.trim() || 'primary';
    const calendar = google.calendar({ version: 'v3', auth: req.oauthClient });
    const calendarTimeZone = await getPrimaryCalendarTimeZone(calendar);
    const start = buildEventTime(start_time, calendarTimeZone);
    const end = buildEventTime(end_time, calendarTimeZone);

    const updateResponse = await calendar.events.update({
      calendarId: resolvedCalendarId,
      eventId: eventId.trim(),
      requestBody: {
        summary: summary.trim(),
        description: description ? description.trim() : undefined,
        location: location ? location.trim() : undefined,
        start,
        end,
      },
    });

    const updatedCalendarId =
      updateResponse.data.organizer?.email ||
      updateResponse.data.creator?.email ||
      resolvedCalendarId;

    const updatedStart = updateResponse.data.start?.dateTime || start_time;
    const updatedEnd = updateResponse.data.end?.dateTime || end_time;

    return res.json({
      action: 'update_event',
      title: summary.trim(),
      url: updateResponse.data.htmlLink,
      embedUrl: buildCalendarEmbedUrl(updatedCalendarId, updatedStart, updatedEnd, calendarTimeZone),
      eventId: updateResponse.data.id || eventId.trim(),
      calendarId: updatedCalendarId,
      start_time: updatedStart,
      end_time: updatedEnd,
      location: location ? location.trim() : '',
      description: description ? description.trim() : '',
      fileType: 'calendar',
      summary: `Updated calendar event: ${summary.trim()}`,
    });
  } catch (error) {
    console.error('Error updating calendar event:', error);
    const message = error instanceof Error ? error.message : 'Failed to update event';
    return res.status(500).json({ error: message });
  }
});

export default router;
