import type { WorkspaceResult } from '../hooks/useTerminal';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/** Google Docs / Sheets / Slides file id from a standard `.../d/{id}/...` URL. */
export function extractGoogleWorkspaceFileIdFromUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
}

/** Sent with every parse request so the backend workspace matches the UI's open file. */
export type ParseWorkspaceHints = {
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  activeSpreadsheetId?: string;
  activeSpreadsheetTitle?: string;
  activePresentationId?: string;
  activePresentationTitle?: string;
  activeFormId?: string;
  activeFormTitle?: string;
};

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export const parseCommand = async (input: string, hints?: ParseWorkspaceHints): Promise<WorkspaceResult> => {
  const response = await fetch(`${API_BASE_URL}/api/parse`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: input, ...hints }),
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return payload as WorkspaceResult;
};

export const getGoogleAuthUrl = (): string => `${API_BASE_URL}/api/auth/google`;

export const checkAuthStatus = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/status`, { credentials: 'include' });
    if (!response.ok) return false;
    const payload = await parseJsonResponse(response);
    return !!payload?.authenticated;
  } catch {
    return false;
  }
};

export const getAuthStatus = checkAuthStatus;

export interface GmailDraftSummary {
  id: string;
  to: string;
  subject: string;
  snippet: string;
}

export interface GmailOverview {
  drafts: GmailDraftSummary[];
  summary?: string;
}

export interface GmailDraftDetail {
  id: string;
  to: string;
  subject: string;
  body: string;
  snippet?: string;
}

export interface CalendarEventPayload {
  summary: string;
  start_time: string;
  end_time: string;
  location?: string;
  description?: string;
  calendarId?: string;
}

export const getGmailOverview = async (): Promise<GmailOverview> => {
  const response = await fetch(`${API_BASE_URL}/api/gmail/overview`, {
    method: 'GET',
    credentials: 'include',
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return payload as GmailOverview;
};

export const getGmailDraft = async (draftId: string): Promise<GmailDraftDetail> => {
  const response = await fetch(`${API_BASE_URL}/api/gmail/drafts/${encodeURIComponent(draftId)}`, {
    method: 'GET',
    credentials: 'include',
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return payload as GmailDraftDetail;
};

export const updateGmailDraft = async (draftId: string, payload: { to: string; subject: string; body: string }): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/gmail/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
};

export const sendGmailDraft = async (draftId: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/gmail/drafts/${encodeURIComponent(draftId)}/send`, {
    method: 'POST',
    credentials: 'include',
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
};

export const updateCalendarEvent = async (eventId: string, payload: CalendarEventPayload): Promise<WorkspaceResult> => {
  const response = await fetch(`${API_BASE_URL}/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as WorkspaceResult;
};

export const logout = async (): Promise<void> => {
  await fetch(`${API_BASE_URL}/api/auth/logout`, { credentials: 'include' });
};
