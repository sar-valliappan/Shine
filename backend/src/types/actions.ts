export interface CreateDocumentAction {
  action: 'create_document';
  title: string;
  content_prompt: string;
  sections: string[];
}

export interface CreateSpreadsheetAction {
  action: 'create_spreadsheet';
  title: string;
  headers: string[];
  rows: any[][];
  include_formulas: boolean;
}

export interface CreatePresentationAction {
  action: 'create_presentation';
  title: string;
  slide_prompts: string[];
}

export interface CreateEventAction {
  action: 'create_event';
  summary: string;
  start_time: string;
  end_time: string;
  location?: string;
  description?: string;
}

export interface CreateFormAction {
  action: 'create_form';
  title: string;
  questions: Array<{ title: string; type: 'TEXT' | 'MULTIPLE_CHOICE' }>;
}

export interface CreateDraftAction {
  action: 'create_draft';
  to: string;
  subject: string;
  body_prompt: string;
}

export interface SendEmailAction {
  action: 'send_email';
  to: string;
  subject: string;
  body_prompt: string;
}

export interface ListFilesAction {
  action: 'list_files';
  query?: string;
  limit: number;
}

export interface SearchDriveAction {
  action: 'search_drive';
  query: string;
}

export interface ClarifyAction {
  action: 'clarify';
  question: string;
}

export type WorkspaceAction =
  | CreateDocumentAction
  | CreateSpreadsheetAction
  | CreatePresentationAction
  | CreateEventAction
  | CreateFormAction
  | CreateDraftAction
  | SendEmailAction
  | ListFilesAction
  | SearchDriveAction
  | ClarifyAction;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
}

export interface WorkspaceResult {
  action: string;
  title: string;
  url: string;
  summary?: string;
  fileType: 'doc' | 'sheet' | 'slide' | 'drive' | 'gmail' | 'calendar' | 'form' | 'list' | 'clarify';
  items?: DriveFile[];
}
