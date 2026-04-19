import { google } from 'googleapis';
import type { WorkspaceAction } from '../types/actions.js';
import { parseCommandWithGemini } from '../services/gemini.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';

type CalendarAction = Extract<WorkspaceAction, { action: 'create_event' }>;

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

	if (endDate <= startDate) {
		endDate = addOneDay(startDate);
	}

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

function isExplicitCreateCommand(command: string): boolean {
	return /\b(create|new|schedule|book|set\s+up|add\s+event)\b/i.test(command);
}

export async function executeCalendarAction(
	action: CalendarAction,
	active: ActiveWorkspace,
	originalCommand: string,
	oauthClient: unknown,
): Promise<ParseRouteResult> {
	const calendar = google.calendar({ version: 'v3', auth: oauthClient as any });
	const calendarTimeZone = await getPrimaryCalendarTimeZone(calendar);
	const shouldUpdateActiveEvent = !!active.calendarEvent && !isExplicitCreateCommand(originalCommand);
	const summary = action.summary?.trim() || active.calendarEvent?.title?.trim();
	const startTime = action.start_time || active.calendarEvent?.start_time;
	const endTime = action.end_time || active.calendarEvent?.end_time;
	const location = action.location ?? active.calendarEvent?.location;
	const description = action.description ?? active.calendarEvent?.description;

	if (!summary) {
		throw new Error('create_event requires summary');
	}
	if (!shouldUpdateActiveEvent && (!startTime || !endTime)) {
		throw new Error('create_event requires summary, start_time, end_time');
	}

	const start = buildEventTime(startTime ?? action.start_time ?? '', calendarTimeZone);
	const end = buildEventTime(endTime ?? action.end_time ?? '', calendarTimeZone);

	if (shouldUpdateActiveEvent) {
		const targetCalendarId = active.calendarEvent!.calendarId || 'primary';
		const targetEventId = active.calendarEvent!.id;
		const updated = await calendar.events.update({
			calendarId: targetCalendarId,
			eventId: targetEventId,
			requestBody: {
				summary,
				start,
				end,
				location,
				description,
			},
		});

		const updatedCalendarId = updated.data.organizer?.email || updated.data.creator?.email || targetCalendarId;
		const updatedStart = updated.data.start?.dateTime || action.start_time;
		const updatedEnd = updated.data.end?.dateTime || action.end_time;

		return {
			action: 'update_event',
			title: summary,
			url: updated.data.htmlLink ?? '',
			embedUrl: buildCalendarEmbedUrl(updatedCalendarId, updatedStart, updatedEnd, calendarTimeZone),
			eventId: updated.data.id ?? targetEventId,
			calendarId: updatedCalendarId,
			start_time: updatedStart,
			end_time: updatedEnd,
			location,
			description,
			fileType: 'calendar',
			summary: `Updated calendar event: ${summary}`,
		};
	}

	const event = await calendar.events.insert({
		calendarId: 'primary',
		requestBody: {
			summary,
			start,
			end,
			location,
			description,
		},
	});
	const calendarId = event.data.organizer?.email || event.data.creator?.email || 'primary';
	const createdStart = event.data.start?.dateTime || action.start_time;
	const createdEnd = event.data.end?.dateTime || action.end_time;

	return {
		action: 'create_event',
		title: summary,
		url: event.data.htmlLink ?? '',
		embedUrl: buildCalendarEmbedUrl(calendarId, createdStart, createdEnd, calendarTimeZone),
		eventId: event.data.id ?? undefined,
		calendarId,
		start_time: createdStart,
		end_time: createdEnd,
		location,
		description,
		fileType: 'calendar',
		summary: `Created calendar event: ${summary}`,
	};
}

// ── App-level entry point (called by app-router) ──────────────────────────
// TODO: Replace parseCommandWithGemini call with a Calendar-specific Gemini call
// that receives the user command + full Calendar API command list and returns
// the exact sequence of API operations to run.
export async function handleCalendarCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	const parsed = await parseCommandWithGemini(command, active);
	void apiKey;
	return executeCalendarAction(parsed.action as CalendarAction, active, command, oauthClient);
}
