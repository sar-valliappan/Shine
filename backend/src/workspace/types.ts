/** Successful /api/parse payload shape consumed by the frontend */
export type ParseRouteResult = {
	action: string;
	title?: string;
	/** Drive filename for the UI — stable across generic edit summaries like "Text styled". */
	documentTitle?: string;
	/** When set, updates the active session document title (e.g. after Drive rename). */
	activeDocumentTitle?: string;
	url?: string;
	embedUrl?: string;
	eventId?: string;
	calendarId?: string;
	start_time?: string;
	end_time?: string;
	location?: string;
	description?: string;
	fileType: string;
	summary: string;
	items?: unknown[];
};
