import { google } from 'googleapis';
import type { WorkspaceAction } from '../types/actions.js';
import type { ParseRouteResult } from './types.js';

type SheetAction = Extract<WorkspaceAction, { action: 'create_spreadsheet' | 'edit_spreadsheet' }>;

export async function executeSpreadsheetAction(
	action: SheetAction,
	oauthClient: unknown,
): Promise<ParseRouteResult> {
	if (action.action === 'create_spreadsheet') {
		return createSpreadsheet(action, oauthClient);
	}
	return editSpreadsheet(action, oauthClient);
}

async function createSpreadsheet(
	action: Extract<WorkspaceAction, { action: 'create_spreadsheet' }>,
	oauthClient: unknown,
): Promise<ParseRouteResult> {
	const sheets = google.sheets({ version: 'v4', auth: oauthClient as any });
	const title = action.title?.trim();
	const headers = action.headers || [];
	const rows = action.rows || [];
	if (!title || headers.length === 0) throw new Error('create_spreadsheet requires title and headers');

	const toCell = (val: unknown) => {
		if (typeof val === 'number') return { userEnteredValue: { numberValue: val } };
		const str = String(val ?? '');
		if (action.include_formulas && str.startsWith('=')) return { userEnteredValue: { formulaValue: str } };
		return { userEnteredValue: { stringValue: str } };
	};

	const spreadsheet = await sheets.spreadsheets.create({
		requestBody: {
			properties: { title },
			sheets: [
				{
					data: [
						{
							startRow: 0,
							startColumn: 0,
							rowData: [
								{ values: headers.map((h) => toCell(h)) },
								...rows.map((row) => ({ values: row.map((cell) => toCell(cell)) })),
							],
						},
					],
				},
			],
		},
	});

	const spreadsheetId = spreadsheet.data.spreadsheetId;
	if (!spreadsheetId) throw new Error('Failed to create spreadsheet');

	return {
		action: 'create_spreadsheet',
		title,
		url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
		fileType: 'sheet',
		summary: `Created Google Sheet: ${title}`,
	};
}

async function editSpreadsheet(
	action: Extract<WorkspaceAction, { action: 'edit_spreadsheet' }>,
	oauthClient: unknown,
): Promise<ParseRouteResult> {
	const fileId = action.fileId;
	if (!fileId) throw new Error('No active spreadsheet to edit. Create one first.');

	const sheets = google.sheets({ version: 'v4', auth: oauthClient as any });
	const url = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;

	if (action.operation === 'add_row') {
		const row = action.row ?? [];
		await sheets.spreadsheets.values.append({
			spreadsheetId: fileId,
			range: 'Sheet1',
			valueInputOption: 'USER_ENTERED',
			requestBody: { values: [row] },
		});
		return { action: 'edit_spreadsheet', title: 'Row added', url, fileType: 'sheet', summary: `Added row: ${row.join(', ')}` };
	}

	if (action.operation === 'add_column') {
		const header = action.header?.trim() ?? 'New Column';
		const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId });
		const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: fileId,
			requestBody: { requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: 1 } }] },
		});
		return { action: 'edit_spreadsheet', title: header, url, fileType: 'sheet', summary: `Added column "${header}"` };
	}

	throw new Error(`Unknown edit_spreadsheet operation: ${action.operation}`);
}
