import type { WorkspaceResult } from '../hooks/useTerminal';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export const parseCommand = async (input: string): Promise<WorkspaceResult> => {
  const response = await fetch(`${API_BASE_URL}/api/parse`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: input })
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

export const logout = async (): Promise<void> => {
  await fetch(`${API_BASE_URL}/api/auth/logout`, { credentials: 'include' });
};
