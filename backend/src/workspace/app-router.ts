import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';
import { handleDocsCommand } from './documents.js';
import { handleSheetsCommand } from './spreadsheets.js';
import { handleSlidesCommand } from './presentations.js';
import { handleGmailCommand } from './gmail.js';
import { handleFormsCommand } from './forms.js';
import { handleDriveCommand } from './drive.js';
import { handleCalendarCommand } from './calendar.js';

export type AppName = 'docs' | 'sheets' | 'slides' | 'gmail' | 'forms' | 'drive' | 'calendar';

export async function executeAppCommand(
	app: AppName,
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	switch (app) {
		case 'docs':     return handleDocsCommand(command, oauthClient, active, apiKey);
		case 'sheets':   return handleSheetsCommand(command, oauthClient, active, apiKey);
		case 'slides':   return handleSlidesCommand(command, oauthClient, active, apiKey);
		case 'gmail':    return handleGmailCommand(command, oauthClient, active, apiKey);
		case 'forms':    return handleFormsCommand(command, oauthClient, active, apiKey);
		case 'drive':    return handleDriveCommand(command, oauthClient, active, apiKey);
		case 'calendar': return handleCalendarCommand(command, oauthClient, active, apiKey);
	}
}
