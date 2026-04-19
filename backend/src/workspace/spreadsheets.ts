import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSheetsPrompt } from '../prompts/sheetsPrompt.js';
import type { ActiveWorkspace } from './activeSession.js';
import type { ParseRouteResult } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────

interface CreateIntent {
	intent: 'create';
	title: string;
	sheets: Array<{
		title?: string;
		headers: string[];
		rows: Array<Array<string | number | boolean>>;
		include_formulas?: boolean;
	}>;
}

interface EditIntent {
	intent: 'edit';
	operations: SheetsOperation[];
}

type SheetsIntent = CreateIntent | EditIntent;

type SheetsOperation =
	| { op: 'updateCells'; sheetId?: number; startRow: number; startColumn: number; values: unknown[][] }
	| { op: 'appendCells'; sheetId?: number; values: unknown[][] }
	| { op: 'findReplace'; find: string; replacement: string; matchCase?: boolean; matchEntireCell?: boolean; allSheets?: boolean; sheetId?: number }
	| { op: 'addSheet'; title: string; index?: number }
	| { op: 'deleteSheet'; sheetId: number }
	| { op: 'duplicateSheet'; sheetId: number; newIndex?: number; newTitle?: string }
	| { op: 'updateSheetProperties'; sheetId: number; title?: string; tabColorHex?: string }
	| { op: 'updateSpreadsheetProperties'; title: string }
	| { op: 'insertDimension'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; startIndex: number; endIndex: number }
	| { op: 'deleteDimension'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; startIndex: number; endIndex: number }
	| { op: 'appendDimension'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; length: number }
	| { op: 'moveDimension'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; startIndex: number; endIndex: number; destinationIndex: number }
	| { op: 'autoResizeDimensions'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; startIndex: number; endIndex: number }
	| { op: 'updateDimensionProperties'; sheetId?: number; dimension: 'ROWS' | 'COLUMNS'; startIndex: number; endIndex: number; hidden?: boolean; pixelSize?: number }
	| { op: 'insertRange'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; shiftDimension: 'ROWS' | 'COLUMNS' }
	| { op: 'deleteRange'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; shiftDimension: 'ROWS' | 'COLUMNS' }
	| { op: 'mergeCells'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; mergeType?: string }
	| { op: 'unmergeCells'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number }
	| { op: 'randomizeRange'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number }
	| { op: 'repeatCell'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; bold?: boolean; italic?: boolean; fontSize?: number; backgroundColorHex?: string; fontColorHex?: string; horizontalAlignment?: string }
	| { op: 'updateBorders'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; top?: boolean; bottom?: boolean; left?: boolean; right?: boolean; innerHorizontal?: boolean; innerVertical?: boolean; style?: string; colorHex?: string }
	| { op: 'addBanding'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; headerColorHex?: string; firstBandColorHex?: string; secondBandColorHex?: string }
	| { op: 'sortRange'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; sortSpecs: Array<{ columnIndex: number; ascending?: boolean }> }
	| { op: 'setBasicFilter'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number }
	| { op: 'clearBasicFilter'; sheetId?: number }
	| { op: 'trimWhitespace'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number }
	| { op: 'deleteDuplicates'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; comparisonColumns?: number[] }
	| { op: 'setDataValidation'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; type: string; values?: string[]; strict?: boolean; showDropdown?: boolean }
	| { op: 'addConditionalFormatRule'; sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number; conditionType: string; conditionValues?: string[]; backgroundColorHex?: string; fontColorHex?: string }
	| { op: 'addChart'; sheetId?: number; chartType: string; title?: string; dataStartRow: number; dataEndRow: number; dataStartColumn: number; dataEndColumn: number; anchorRow?: number; anchorColumn?: number };

// ── Helpers ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
	const clean = hex.replace('#', '');
	return {
		red: parseInt(clean.slice(0, 2), 16) / 255,
		green: parseInt(clean.slice(2, 4), 16) / 255,
		blue: parseInt(clean.slice(4, 6), 16) / 255,
	};
}

function toCell(val: unknown, includeFormulas = false) {
	if (typeof val === 'number') return { userEnteredValue: { numberValue: val } };
	if (typeof val === 'boolean') return { userEnteredValue: { boolValue: val } };
	const str = String(val ?? '');
	if (includeFormulas && str.startsWith('=')) return { userEnteredValue: { formulaValue: str } };
	return { userEnteredValue: { stringValue: str } };
}

function gridRange(op: { sheetId?: number; startRow: number; endRow: number; startColumn: number; endColumn: number }) {
	return {
		sheetId: op.sheetId ?? 0,
		startRowIndex: op.startRow,
		endRowIndex: op.endRow,
		startColumnIndex: op.startColumn,
		endColumnIndex: op.endColumn,
	};
}

function borderStyle(style = 'SOLID', colorHex = '#000000') {
	return { style, color: hexToRgb(colorHex) };
}

const DEFAULT_MODEL_CANDIDATES = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it'] as const;

// ── Gemini call ───────────────────────────────────────────────────────────

async function callGeminiForSheets(prompt: string, apiKey: string): Promise<SheetsIntent> {
	const client = new GoogleGenerativeAI(apiKey);
	const configuredModel = process.env.GEMINI_MODEL?.trim();
	const candidates = configuredModel
		? [configuredModel, ...DEFAULT_MODEL_CANDIDATES.filter((m) => m !== configuredModel)]
		: [...DEFAULT_MODEL_CANDIDATES];

	let text = '';
	for (const modelName of candidates) {
		try {
			const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
			const result = await model.generateContent(prompt);
			text = result.response.text().trim();
			break;
		} catch (err) {
			console.error(`[sheets:gemini] Model failed: ${modelName}`, err);
		}
	}

	if (!text) throw new Error('All Gemini models failed for sheets command');

	const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
	const jsonStart = cleaned.indexOf('{');
	if (jsonStart === -1) throw new Error('No JSON found in Gemini response');
	const parsed = JSON.parse(cleaned.slice(jsonStart));

	if (!parsed.intent) throw new Error('Gemini response missing intent field');
	return parsed as SheetsIntent;
}

// ── Operation → batchUpdate request ───────────────────────────────────────

function buildRequest(op: SheetsOperation): any {
	const sid = (op as any).sheetId ?? 0;

	switch (op.op) {
		case 'updateCells':
			return {
				updateCells: {
					range: { sheetId: sid, startRowIndex: op.startRow, startColumnIndex: op.startColumn },
					rows: op.values.map((row) => ({ values: (row as unknown[]).map((v) => toCell(v, true)) })),
					fields: 'userEnteredValue',
				},
			};

		case 'appendCells':
			return {
				appendCells: {
					sheetId: sid,
					rows: op.values.map((row) => ({ values: (row as unknown[]).map((v) => toCell(v, true)) })),
					fields: 'userEnteredValue',
				},
			};

		case 'findReplace':
			return {
				findReplace: {
					find: op.find,
					replacement: op.replacement,
					matchCase: op.matchCase ?? false,
					matchEntireCell: op.matchEntireCell ?? false,
					allSheets: op.allSheets ?? true,
					...(!op.allSheets && op.sheetId !== undefined ? { sheetId: op.sheetId } : {}),
				},
			};

		case 'addSheet':
			return {
				addSheet: {
					properties: {
						title: op.title,
						...(op.index !== undefined ? { index: op.index } : {}),
					},
				},
			};

		case 'deleteSheet':
			return { deleteSheet: { sheetId: op.sheetId } };

		case 'duplicateSheet':
			return {
				duplicateSheet: {
					sourceSheetId: op.sheetId,
					...(op.newIndex !== undefined ? { insertSheetIndex: op.newIndex } : {}),
					...(op.newTitle ? { newSheetName: op.newTitle } : {}),
				},
			};

		case 'updateSheetProperties': {
			const props: any = { sheetId: op.sheetId };
			const fields: string[] = [];
			if (op.title) { props.title = op.title; fields.push('title'); }
			if (op.tabColorHex) { props.tabColorStyle = { rgbColor: hexToRgb(op.tabColorHex) }; fields.push('tabColorStyle'); }
			return { updateSheetProperties: { properties: props, fields: fields.join(',') || 'title' } };
		}

		case 'updateSpreadsheetProperties':
			return {
				updateSpreadsheetProperties: {
					properties: { title: op.title },
					fields: 'title',
				},
			};

		case 'insertDimension':
			return {
				insertDimension: {
					range: { sheetId: sid, dimension: op.dimension, startIndex: op.startIndex, endIndex: op.endIndex },
					inheritFromBefore: false,
				},
			};

		case 'deleteDimension':
			return {
				deleteDimension: {
					range: { sheetId: sid, dimension: op.dimension, startIndex: op.startIndex, endIndex: op.endIndex },
				},
			};

		case 'appendDimension':
			return { appendDimension: { sheetId: sid, dimension: op.dimension, length: op.length } };

		case 'moveDimension':
			return {
				moveDimension: {
					source: { sheetId: sid, dimension: op.dimension, startIndex: op.startIndex, endIndex: op.endIndex },
					destinationIndex: op.destinationIndex,
				},
			};

		case 'autoResizeDimensions':
			return {
				autoResizeDimensions: {
					dimensions: { sheetId: sid, dimension: op.dimension, startIndex: op.startIndex, endIndex: op.endIndex },
				},
			};

		case 'updateDimensionProperties': {
			const dimProps: any = {};
			const dimFields: string[] = [];
			if (op.hidden !== undefined) { dimProps.hiddenByUser = op.hidden; dimFields.push('hiddenByUser'); }
			if (op.pixelSize !== undefined) { dimProps.pixelSize = op.pixelSize; dimFields.push('pixelSize'); }
			return {
				updateDimensionProperties: {
					range: { sheetId: sid, dimension: op.dimension, startIndex: op.startIndex, endIndex: op.endIndex },
					properties: dimProps,
					fields: dimFields.join(',') || 'hiddenByUser',
				},
			};
		}

		case 'insertRange':
			return {
				insertRange: {
					range: gridRange(op),
					shiftDimension: op.shiftDimension,
				},
			};

		case 'deleteRange':
			return {
				deleteRange: {
					range: gridRange(op),
					shiftDimension: op.shiftDimension,
				},
			};

		case 'mergeCells':
			return {
				mergeCells: {
					range: gridRange(op),
					mergeType: op.mergeType ?? 'MERGE_ALL',
				},
			};

		case 'unmergeCells':
			return { unmergeCells: { range: gridRange(op) } };

		case 'randomizeRange':
			return { randomizeRange: { range: gridRange(op) } };

		case 'repeatCell': {
			const cellFormat: any = {};
			const cellFields: string[] = [];
			if (op.bold !== undefined || op.italic !== undefined || op.fontSize !== undefined || op.fontColorHex) {
				cellFormat.textFormat = {};
				if (op.bold !== undefined) { cellFormat.textFormat.bold = op.bold; cellFields.push('userEnteredFormat.textFormat.bold'); }
				if (op.italic !== undefined) { cellFormat.textFormat.italic = op.italic; cellFields.push('userEnteredFormat.textFormat.italic'); }
				if (op.fontSize !== undefined) { cellFormat.textFormat.fontSize = op.fontSize; cellFields.push('userEnteredFormat.textFormat.fontSize'); }
				if (op.fontColorHex) { cellFormat.textFormat.foregroundColorStyle = { rgbColor: hexToRgb(op.fontColorHex) }; cellFields.push('userEnteredFormat.textFormat.foregroundColorStyle'); }
			}
			if (op.backgroundColorHex) { cellFormat.backgroundColorStyle = { rgbColor: hexToRgb(op.backgroundColorHex) }; cellFields.push('userEnteredFormat.backgroundColorStyle'); }
			if (op.horizontalAlignment) { cellFormat.horizontalAlignment = op.horizontalAlignment; cellFields.push('userEnteredFormat.horizontalAlignment'); }
			return {
				repeatCell: {
					range: gridRange(op),
					cell: { userEnteredFormat: cellFormat },
					fields: cellFields.join(',') || 'userEnteredFormat',
				},
			};
		}

		case 'updateBorders': {
			const makeBorder = (enabled: boolean | undefined) =>
				enabled ? borderStyle(op.style, op.colorHex) : { style: 'NONE' };
			return {
				updateBorders: {
					range: gridRange(op),
					top: makeBorder(op.top),
					bottom: makeBorder(op.bottom),
					left: makeBorder(op.left),
					right: makeBorder(op.right),
					innerHorizontal: makeBorder(op.innerHorizontal),
					innerVertical: makeBorder(op.innerVertical),
				},
			};
		}

		case 'addBanding':
			return {
				addBanding: {
					bandedRange: {
						range: gridRange(op),
						rowProperties: {
							...(op.headerColorHex ? { headerColor: hexToRgb(op.headerColorHex) } : {}),
							firstBandColor: hexToRgb(op.firstBandColorHex ?? '#FFFFFF'),
							secondBandColor: hexToRgb(op.secondBandColorHex ?? '#F3F3F3'),
						},
					},
				},
			};

		case 'sortRange':
			return {
				sortRange: {
					range: gridRange(op),
					sortSpecs: op.sortSpecs.map((s) => ({
						dimensionIndex: s.columnIndex,
						sortOrder: s.ascending === false ? 'DESCENDING' : 'ASCENDING',
					})),
				},
			};

		case 'setBasicFilter':
			return {
				setBasicFilter: {
					filter: { range: gridRange(op) },
				},
			};

		case 'clearBasicFilter':
			return { clearBasicFilter: { sheetId: sid } };

		case 'trimWhitespace':
			return { trimWhitespace: { range: gridRange(op) } };

		case 'deleteDuplicates':
			return {
				deleteDuplicates: {
					range: gridRange(op),
					comparisonColumns: (op.comparisonColumns ?? [0]).map((i) => ({
						sheetId: sid,
						dimension: 'COLUMNS',
						startIndex: i,
						endIndex: i + 1,
					})),
				},
			};

		case 'setDataValidation': {
			const condMap: Record<string, string> = {
				ONE_OF_LIST: 'ONE_OF_LIST',
				NUMBER_GREATER: 'NUMBER_GREATER',
				NUMBER_BETWEEN: 'NUMBER_BETWEEN',
				TEXT_CONTAINS: 'TEXT_CONTAINS',
				DATE_IS_VALID: 'DATE_IS_VALID',
			};
			return {
				setDataValidation: {
					range: gridRange(op),
					rule: {
						condition: {
							type: condMap[op.type] ?? op.type,
							values: (op.values ?? []).map((v) => ({ userEnteredValue: v })),
						},
						strict: op.strict ?? true,
						showCustomUi: op.showDropdown ?? true,
					},
				},
			};
		}

		case 'addConditionalFormatRule': {
			const boolFormat: any = {};
			if (op.backgroundColorHex) boolFormat.backgroundColor = hexToRgb(op.backgroundColorHex);
			if (op.fontColorHex) boolFormat.textFormat = { foregroundColor: hexToRgb(op.fontColorHex) };
			return {
				addConditionalFormatRule: {
					rule: {
						ranges: [gridRange(op)],
						booleanRule: {
							condition: {
								type: op.conditionType,
								values: (op.conditionValues ?? []).map((v) => ({ userEnteredValue: v })),
							},
							format: { ...boolFormat },
						},
					},
					index: 0,
				},
			};
		}

		case 'addChart': {
			const chartTypeMap: Record<string, string> = {
				BAR: 'BAR', COLUMN: 'COLUMN', LINE: 'LINE',
				PIE: 'PIE', SCATTER: 'SCATTER', AREA: 'AREA',
			};
			return {
				addChart: {
					chart: {
						spec: {
							title: op.title ?? '',
							basicChart: {
								chartType: chartTypeMap[op.chartType?.toUpperCase()] ?? 'COLUMN',
								domains: [{
									domain: {
										sourceRange: {
											sources: [{
												sheetId: sid,
												startRowIndex: op.dataStartRow,
												endRowIndex: op.dataEndRow,
												startColumnIndex: op.dataStartColumn,
												endColumnIndex: op.dataStartColumn + 1,
											}],
										},
									},
								}],
								series: [{
									series: {
										sourceRange: {
											sources: [{
												sheetId: sid,
												startRowIndex: op.dataStartRow,
												endRowIndex: op.dataEndRow,
												startColumnIndex: op.dataStartColumn + 1,
												endColumnIndex: op.dataEndColumn,
											}],
										},
									},
								}],
							},
						},
						position: {
							overlayPosition: {
								anchorCell: {
									sheetId: sid,
									rowIndex: op.anchorRow ?? 2,
									columnIndex: op.anchorColumn ?? 5,
								},
							},
						},
					},
				},
			};
		}

		default:
			throw new Error(`Unknown sheets operation: ${(op as any).op}`);
	}
}

// ── App-level entry point (called by app-router) ──────────────────────────

export async function handleSheetsCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	apiKey: string | undefined,
): Promise<ParseRouteResult> {
	if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

	const sheets = google.sheets({ version: 'v4', auth: oauthClient as any });

	// Build context block for Gemini
	let activeContext = '';
	if (active.spreadsheet) {
		try {
			const meta = await sheets.spreadsheets.get({ spreadsheetId: active.spreadsheet.id });
			const sheetList = (meta.data.sheets ?? []).map((s) => ({
				sheetId: s.properties?.sheetId,
				title: s.properties?.title,
				index: s.properties?.index,
			}));

			// Fetch actual cell data so Gemini knows headers, column positions, and row count
			let dataContext = '';
			try {
				const firstSheetTitle = sheetList[0]?.title ?? 'Sheet1';
				const dataRes = await sheets.spreadsheets.values.get({
					spreadsheetId: active.spreadsheet.id,
					range: `${firstSheetTitle}!A1:Z100`,
				});
				const rows = dataRes.data.values ?? [];
				if (rows.length > 0) {
					const headerRow = rows[0];
					const dataRows = rows.slice(1);
					const colCount = headerRow.length;
					const lines = [
						`\nSheet "${firstSheetTitle}" has ${colCount} columns and ${dataRows.length} data row(s).`,
						`Headers (row 0): ${JSON.stringify(headerRow)}`,
						`Column indexes: ${headerRow.map((h: string, i: number) => `${i}="${h}"`).join(', ')}`,
					];
					// Include up to 10 data rows so Gemini can see existing values
					dataRows.slice(0, 10).forEach((row, i) => {
						lines.push(`Row ${i + 1}: ${JSON.stringify(row)}`);
					});
					if (dataRows.length > 10) lines.push(`... (${dataRows.length - 10} more rows)`);
					dataContext = '\n' + lines.join('\n');
				}
			} catch { /* best-effort — proceed without row data */ }

			activeContext = `\n\nActive spreadsheet — "${active.spreadsheet.title}" (id: ${active.spreadsheet.id})\nTabs: ${JSON.stringify(sheetList)}\nUse the sheetId values above when targeting a specific tab.${dataContext}`;
		} catch {
			activeContext = `\n\nActive spreadsheet — "${active.spreadsheet.title}" (id: ${active.spreadsheet.id})`;
		}
	}

	const prompt = buildSheetsPrompt(command, activeContext);
	const intent = await callGeminiForSheets(prompt, apiKey);

	// ── CREATE ──────────────────────────────────────────────────────────
	if (intent.intent === 'create') {
		const title = intent.title?.trim() || 'Untitled Spreadsheet';
		const sheetDefs = intent.sheets?.length ? intent.sheets : [{ headers: [], rows: [] }];

		const spreadsheet = await sheets.spreadsheets.create({
			requestBody: {
				properties: { title },
				sheets: sheetDefs.map((s, i) => ({
					properties: { title: s.title ?? (i === 0 ? 'Sheet1' : `Sheet${i + 1}`) },
					data: s.headers.length
						? [{
							startRow: 0,
							startColumn: 0,
							rowData: [
								{ values: s.headers.map((h) => toCell(h)) },
								...(s.rows ?? []).map((row) => ({
									values: row.map((v) => toCell(v, s.include_formulas)),
								})),
							],
						}]
						: [],
				})),
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

	// ── EDIT ─────────────────────────────────────────────────────────────
	if (!active.spreadsheet) {
		throw new Error('No active spreadsheet to edit. Create one first or open a sheet.');
	}

	const spreadsheetId = active.spreadsheet.id;
	const ops = intent.operations ?? [];

	if (ops.length === 0) {
		return {
			action: 'edit_spreadsheet',
			title: active.spreadsheet.title,
			url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
			fileType: 'sheet',
			summary: 'No operations were needed for that command.',
		};
	}

	const requests = ops.map((op) => buildRequest(op));
	await sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		requestBody: { requests },
	});

	const opSummary = ops.map((o) => o.op).join(', ');
	return {
		action: 'edit_spreadsheet',
		title: active.spreadsheet.title,
		url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
		fileType: 'sheet',
		summary: `Updated spreadsheet: ${opSummary}`,
	};
}
