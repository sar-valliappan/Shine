import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import { buildSlidesPrompt, buildSlidesContentPrompt } from '../prompts/slidesPrompt.js';
import type { ActiveWorkspace } from './activeSession.js';
import { executeWorkspaceAction } from './executeWorkspaceAction.js';
import type { ParseRouteResult } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────

interface CreateIntent {
	intent: 'create';
	title: string;
	slide_prompts?: string[];
}

interface EditIntent {
	intent: 'edit';
	operations: SlidesOperation[];
}

type SlidesIntent = CreateIntent | EditIntent;

type SlidesOperation =
	// SLIDES
	| { op: 'createSlide'; objectId: string; insertionIndex?: number; layout: string; placeholderIdMappings?: Array<{ type: string; objectId: string }> }
	| { op: 'deleteObject'; objectId: string }
	| { op: 'updateSlideProperties'; objectId: string; isSkipped?: boolean }
	| { op: 'updateSlidesPosition'; slideObjectIds: string[]; insertionIndex: number }
	| { op: 'updatePageProperties'; objectId: string; pageBackgroundFillHex?: string }
	| { op: 'duplicateObject'; objectId: string; newObjectId?: string }

	// CREATING ELEMENTS
	| { op: 'createShape'; objectId: string; pageObjectId: string; shapeType: string; width?: number; height?: number; translateX?: number; translateY?: number }
	| { op: 'createTable'; objectId: string; pageObjectId: string; rows: number; columns: number; width?: number; height?: number; translateX?: number; translateY?: number }
	| { op: 'createImage'; objectId: string; pageObjectId: string; url: string; width?: number; height?: number; translateX?: number; translateY?: number }
	| { op: 'createVideo'; objectId: string; pageObjectId: string; source: string; id: string; width?: number; height?: number; translateX?: number; translateY?: number }
	| { op: 'createLine'; objectId: string; pageObjectId: string; lineCategory: string; width?: number; height?: number; translateX?: number; translateY?: number }
	| { op: 'createSheetsChart'; objectId: string; pageObjectId: string; spreadsheetId: string; chartId: number; linkingMode: string; width?: number; height?: number; translateX?: number; translateY?: number }

	// TEXT
	| { op: 'updateText'; objectId: string; text: string }
	| { op: 'insertText'; objectId: string; text: string; insertionIndex?: number }
	| { op: 'deleteText'; objectId: string; startIndex?: number; endIndex?: number }
	| { op: 'replaceAllText'; replaceText: string; containsText: string; matchCase?: boolean; pageObjectIds?: string[] }
	| { op: 'updateTextStyle'; objectId: string; bold?: boolean; italic?: boolean; fontFamily?: string; fontSize?: number; foregroundColorHex?: string; backgroundColorHex?: string }
	| { op: 'updateParagraphStyle'; objectId: string; alignment?: string; lineSpacing?: number }
	| { op: 'createParagraphBullets'; objectId: string; bulletPreset: string }
	| { op: 'deleteParagraphBullets'; objectId: string }

	// TABLES
	| { op: 'insertTableRows'; tableObjectId: string; rowIndex: number; columnIndex: number; insertBelow?: boolean; number?: number }
	| { op: 'insertTableColumns'; tableObjectId: string; rowIndex: number; columnIndex: number; insertRight?: boolean; number?: number }
	| { op: 'deleteTableRow'; tableObjectId: string; rowIndex: number; columnIndex: number }
	| { op: 'deleteTableColumn'; tableObjectId: string; rowIndex: number; columnIndex: number }
	| { op: 'updateTableCellProperties'; tableObjectId: string; rowIndex: number; columnIndex: number; rowSpan?: number; columnSpan?: number; tableCellBackgroundFillHex?: string; contentAlignment?: string }
	| { op: 'updateTableBorderProperties'; tableObjectId: string; rowIndex: number; columnIndex: number; rowSpan?: number; columnSpan?: number; borderPosition: string; solidFillHex?: string; weight?: number; dashStyle?: string }
	| { op: 'updateTableColumnProperties'; tableObjectId: string; columnIndices: number[]; columnWidth: number }
	| { op: 'updateTableRowProperties'; tableObjectId: string; rowIndices: number[]; minRowHeight: number }
	| { op: 'mergeTableCells'; tableObjectId: string; rowIndex: number; columnIndex: number; rowSpan: number; columnSpan: number }
	| { op: 'unmergeTableCells'; tableObjectId: string; rowIndex: number; columnIndex: number; rowSpan: number; columnSpan: number }

	// REPLACING
	| { op: 'replaceAllShapesWithImage'; imageUrl: string; containsText: string; matchCase?: boolean; pageObjectIds?: string[] }
	| { op: 'replaceAllShapesWithSheetsChart'; spreadsheetId: string; chartId: number; linkingMode: string; containsText: string; matchCase?: boolean; pageObjectIds?: string[] }
	| { op: 'replaceImage'; imageObjectId: string; url: string; replacementMethod: string }

	// TRANSFORM & GROUPING
	| { op: 'updatePageElementTransform'; objectId: string; scaleX?: number; scaleY?: number; translateX?: number; translateY?: number; applyMode?: string }
	| { op: 'updatePageElementsZOrder'; pageElementObjectIds: string[]; zOrderOperation: string }
	| { op: 'updatePageElementAltText'; objectId: string; title?: string; description?: string }
	| { op: 'groupObjects'; childrenObjectIds: string[]; groupObjectId?: string }
	| { op: 'ungroupObjects'; objectIds: string[] }

	// PROPERTIES
	| { op: 'updateShapeProperties'; objectId: string; shapeBackgroundFillHex?: string; shapeBackgroundFillAlpha?: number }
	| { op: 'updateImageProperties'; objectId: string; brightness?: number; contrast?: number }
	| { op: 'updateVideoProperties'; objectId: string; autoPlay?: boolean; mute?: boolean }
	| { op: 'updateLineProperties'; objectId: string; lineFillHex?: string; weight?: number; dashStyle?: string }
	| { op: 'updateLineCategory'; objectId: string; lineCategory: string }
	| { op: 'rerouteLine'; objectId: string }
	| { op: 'refreshSheetsChart'; objectIds: string[] };

// ── Deck content types (returned by AI, rendered by code) ─────────────────

interface Palette { bg: string; accent: string; subtle: string; }

interface TitleSlide { type: 'title'; title: string; subtitle: string; image?: string; }
interface ContentSlide { type: 'content'; label?: string; title: string; bullets: string[]; image?: string; }
interface HighlightSlide { type: 'highlight'; label?: string; stats: Array<{ value: string; caption: string }>; image?: string; }
interface QuoteSlide { type: 'quote'; quote: string; attribution?: string; image?: string; }
interface SectionSlide { type: 'section'; number?: string; title: string; teaser?: string; }
interface ConclusionSlide { type: 'conclusion'; statement: string; cta?: string; }
type SlideSpec = TitleSlide | ContentSlide | HighlightSlide | QuoteSlide | SectionSlide | ConclusionSlide;

interface DeckSpec { title: string; palette: Palette; slides: SlideSpec[]; }

// ── Helpers ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
	const clean = hex.replace('#', '');
	return {
		red: parseInt(clean.slice(0, 2), 16) / 255,
		green: parseInt(clean.slice(2, 4), 16) / 255,
		blue: parseInt(clean.slice(4, 6), 16) / 255,
	};
}

function buildElementProperties(width?: number, height?: number, translateX?: number, translateY?: number, pageObjectId?: string) {
	const props: any = {};
	if (pageObjectId) props.pageObjectId = pageObjectId;
	if (width !== undefined && height !== undefined) {
		props.size = { width: { magnitude: width, unit: 'PT' }, height: { magnitude: height, unit: 'PT' } };
	}
	if (translateX !== undefined || translateY !== undefined) {
		props.transform = {
			scaleX: 1, scaleY: 1,
			translateX: translateX ?? 0, translateY: translateY ?? 0,
			unit: 'PT',
		};
	}
	return props;
}

function sanitizeJson(raw: string): string {
	let inString = false;
	let escaped = false;
	let out = '';
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		const code = raw.charCodeAt(i);
		if (escaped) { out += ch; escaped = false; continue; }
		if (ch === '\\') { escaped = true; out += ch; continue; }
		if (ch === '"') { inString = !inString; out += ch; continue; }
		if (inString && code < 0x20) {
			if (code === 0x0a) out += '\\n';
			else if (code === 0x0d) out += '\\r';
			else if (code === 0x09) out += '\\t';
			else out += `\\u${code.toString(16).padStart(4, '0')}`;
			continue;
		}
		out += ch;
	}
	return out;
}

function parseJsonResponse(text: string): any {
	const cleaned = text.replace(/^\s*```json\s*/i, '').replace(/^\s*```\s*/i, '').replace(/```\s*$/i, '').trim();
	const jsonStart = cleaned.indexOf('{');
	if (jsonStart === -1) throw new Error('No JSON found in Claude response');
	return JSON.parse(sanitizeJson(cleaned.slice(jsonStart)));
}

// ── Claude calls ──────────────────────────────────────────────────────────

async function callClaude(prompt: string, claudeKey: string): Promise<string> {
	const client = new Anthropic({ apiKey: claudeKey });
	const msg = await client.messages.create({
		model: 'claude-opus-4-5',
		max_tokens: 4096,
		messages: [{ role: 'user', content: prompt }],
	});
	const block = msg.content[0];
	return block.type === 'text' ? block.text.trim() : '';
}

async function callClaudeForContent(prompt: string, claudeKey: string): Promise<DeckSpec> {
	const text = await callClaude(prompt, claudeKey);
	const parsed = parseJsonResponse(text);
	if (!Array.isArray(parsed.slides)) throw new Error('Claude content response missing slides array');
	return parsed as DeckSpec;
}

async function callClaudeForIntent(prompt: string, claudeKey: string): Promise<SlidesIntent> {
	const text = await callClaude(prompt, claudeKey);
	const parsed = parseJsonResponse(text);
	if (!parsed.intent) throw new Error('Claude response missing intent field');
	return parsed as SlidesIntent;
}

// ── ID safety: Google Slides requires object IDs to be ≥ 5 characters ────

const ID_KEYS = new Set([
	'objectId', 'pageObjectId', 'tableObjectId', 'groupObjectId', 'imageObjectId', 'newObjectId',
]);

function enforceMinIdLength(value: unknown, preserve: Set<string> = new Set()): unknown {
	if (Array.isArray(value)) return value.map((v) => enforceMinIdLength(v, preserve));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (ID_KEYS.has(k) && typeof v === 'string' && v.length < 5 && !preserve.has(v)) {
				out[k] = `obj_${v}`;
			} else if ((k === 'slideObjectIds' || k === 'childrenObjectIds' || k === 'pageElementObjectIds' || k === 'pageObjectIds') && Array.isArray(v)) {
				out[k] = (v as string[]).map((id) => (typeof id === 'string' && id.length < 5 && !preserve.has(id) ? `obj_${id}` : id));
			} else {
				out[k] = enforceMinIdLength(v, preserve);
			}
		}
		return out;
	}
	return value;
}

// ── Operation → batchUpdate request ───────────────────────────────────────

function buildRequest(op: SlidesOperation): any {
	switch (op.op) {
		case 'createSlide':
			return {
				createSlide: {
					objectId: op.objectId,
					insertionIndex: op.insertionIndex,
					slideLayoutReference: { predefinedLayout: op.layout },
					placeholderIdMappings: (op.placeholderIdMappings ?? []).map(m => ({
						layoutPlaceholder: { type: m.type },
						objectId: m.objectId,
					})),
				},
			};

		case 'deleteObject':
			return { deleteObject: { objectId: op.objectId } };

		case 'updateSlideProperties':
			return {
				updateSlideProperties: {
					objectId: op.objectId,
					slideProperties: { isSkipped: op.isSkipped },
					fields: 'isSkipped',
				},
			};

		case 'updateSlidesPosition':
			return {
				updateSlidesPosition: {
					slideObjectIds: op.slideObjectIds,
					insertionIndex: op.insertionIndex,
				},
			};

		case 'updatePageProperties':
			return {
				updatePageProperties: {
					objectId: op.objectId,
					pageProperties: op.pageBackgroundFillHex ? {
						pageBackgroundFill: { solidFill: { color: { rgbColor: hexToRgb(op.pageBackgroundFillHex) } } },
					} : {},
					fields: op.pageBackgroundFillHex ? 'pageBackgroundFill' : '',
				},
			};

		case 'duplicateObject':
			return {
				duplicateObject: {
					objectId: op.objectId,
					objectIds: op.newObjectId ? { [op.objectId]: op.newObjectId } : undefined,
				},
			};

		case 'createShape':
			return {
				createShape: {
					objectId: op.objectId,
					shapeType: op.shapeType,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'createTable':
			return {
				createTable: {
					objectId: op.objectId,
					rows: op.rows,
					columns: op.columns,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'createImage':
			return {
				createImage: {
					objectId: op.objectId,
					url: op.url,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'createVideo':
			return {
				createVideo: {
					objectId: op.objectId,
					source: op.source,
					id: op.id,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'createLine':
			return {
				createLine: {
					objectId: op.objectId,
					lineCategory: op.lineCategory,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'createSheetsChart':
			return {
				createSheetsChart: {
					objectId: op.objectId,
					spreadsheetId: op.spreadsheetId,
					chartId: op.chartId,
					linkingMode: op.linkingMode,
					elementProperties: buildElementProperties(op.width, op.height, op.translateX, op.translateY, op.pageObjectId),
				},
			};

		case 'updateText':
			return [
				{ deleteText: { objectId: op.objectId, textRange: { type: 'ALL' } } },
				{ insertText: { objectId: op.objectId, text: op.text, insertionIndex: 0 } },
			];

		case 'insertText':
			return {
				insertText: {
					objectId: op.objectId,
					text: op.text,
					insertionIndex: op.insertionIndex ?? 0,
				},
			};

		case 'deleteText':
			return {
				deleteText: {
					objectId: op.objectId,
					textRange: {
						type: op.startIndex !== undefined && op.endIndex !== undefined ? 'FIXED_BOUNDS' : 'ALL',
						...(op.startIndex !== undefined ? { startIndex: op.startIndex } : {}),
						...(op.endIndex !== undefined ? { endIndex: op.endIndex } : {}),
					},
				},
			};

		case 'replaceAllText':
			return {
				replaceAllText: {
					replaceText: op.replaceText,
					containsText: { text: op.containsText, matchCase: op.matchCase ?? false },
					pageObjectIds: op.pageObjectIds,
				},
			};

		case 'updateTextStyle': {
			const style: any = {};
			const fields: string[] = [];
			if (op.bold !== undefined) { style.bold = op.bold; fields.push('bold'); }
			if (op.italic !== undefined) { style.italic = op.italic; fields.push('italic'); }
			if (op.fontFamily !== undefined) { style.fontFamily = op.fontFamily; fields.push('fontFamily'); }
			if (op.fontSize !== undefined) { style.fontSize = { magnitude: op.fontSize, unit: 'PT' }; fields.push('fontSize'); }
			if (op.foregroundColorHex) { style.foregroundColor = { opaqueColor: { rgbColor: hexToRgb(op.foregroundColorHex) } }; fields.push('foregroundColor'); }
			if (op.backgroundColorHex) { style.backgroundColor = { opaqueColor: { rgbColor: hexToRgb(op.backgroundColorHex) } }; fields.push('backgroundColor'); }
			return {
				updateTextStyle: {
					objectId: op.objectId,
					style,
					fields: fields.join(',') || '*',
					textRange: { type: 'ALL' },
				},
			};
		}

		case 'updateParagraphStyle': {
			const style: any = {};
			const fields: string[] = [];
			if (op.alignment !== undefined) {
				const alignMap: Record<string, string> = { LEFT: 'START', RIGHT: 'END' };
				style.alignment = alignMap[op.alignment] ?? op.alignment;
				fields.push('alignment');
			}
			if (op.lineSpacing !== undefined) { style.lineSpacing = op.lineSpacing; fields.push('lineSpacing'); }
			return {
				updateParagraphStyle: {
					objectId: op.objectId,
					style,
					fields: fields.join(',') || '*',
					textRange: { type: 'ALL' },
				},
			};
		}

		case 'createParagraphBullets':
			return {
				createParagraphBullets: {
					objectId: op.objectId,
					bulletPreset: op.bulletPreset,
					textRange: { type: 'ALL' },
				},
			};

		case 'deleteParagraphBullets':
			return {
				deleteParagraphBullets: {
					objectId: op.objectId,
					textRange: { type: 'ALL' },
				},
			};

		case 'insertTableRows':
			return {
				insertTableRows: {
					tableObjectId: op.tableObjectId,
					cellLocation: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
					insertBelow: op.insertBelow ?? true,
					number: op.number ?? 1,
				},
			};

		case 'insertTableColumns':
			return {
				insertTableColumns: {
					tableObjectId: op.tableObjectId,
					cellLocation: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
					insertRight: op.insertRight ?? true,
					number: op.number ?? 1,
				},
			};

		case 'deleteTableRow':
			return {
				deleteTableRow: {
					tableObjectId: op.tableObjectId,
					cellLocation: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
				},
			};

		case 'deleteTableColumn':
			return {
				deleteTableColumn: {
					tableObjectId: op.tableObjectId,
					cellLocation: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
				},
			};

		case 'updateTableCellProperties': {
			const props: any = {};
			const fields: string[] = [];
			if (op.tableCellBackgroundFillHex) {
				props.tableCellBackgroundFill = { solidFill: { color: { rgbColor: hexToRgb(op.tableCellBackgroundFillHex) } } };
				fields.push('tableCellBackgroundFill.solidFill.color');
			}
			if (op.contentAlignment) {
				props.contentAlignment = op.contentAlignment;
				fields.push('contentAlignment');
			}
			return {
				updateTableCellProperties: {
					objectId: op.tableObjectId,
					tableRange: {
						location: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
						rowSpan: op.rowSpan ?? 1,
						columnSpan: op.columnSpan ?? 1,
					},
					tableCellProperties: props,
					fields: fields.join(',') || '*',
				},
			};
		}

		case 'updateTableBorderProperties':
			return {
				updateTableBorderProperties: {
					objectId: op.tableObjectId,
					tableRange: {
						location: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
						rowSpan: op.rowSpan ?? 1,
						columnSpan: op.columnSpan ?? 1,
					},
					borderPosition: op.borderPosition,
					tableBorderProperties: {
						tableBorderFill: op.solidFillHex ? { solidFill: { color: { rgbColor: hexToRgb(op.solidFillHex) } } } : undefined,
						weight: op.weight ? { magnitude: op.weight, unit: 'PT' } : undefined,
						dashStyle: op.dashStyle,
					},
					fields: [
						op.solidFillHex ? 'tableBorderFill' : '',
						op.weight ? 'weight' : '',
						op.dashStyle ? 'dashStyle' : '',
					].filter(Boolean).join(',') || '*',
				},
			};

		case 'updateTableColumnProperties':
			return {
				updateTableColumnProperties: {
					objectId: op.tableObjectId,
					columnIndices: op.columnIndices,
					tableColumnProperties: { columnWidth: { magnitude: op.columnWidth, unit: 'PT' } },
					fields: 'columnWidth',
				},
			};

		case 'updateTableRowProperties':
			return {
				updateTableRowProperties: {
					objectId: op.tableObjectId,
					rowIndices: op.rowIndices,
					tableRowProperties: { minRowHeight: { magnitude: op.minRowHeight, unit: 'PT' } },
					fields: 'minRowHeight',
				},
			};

		case 'mergeTableCells':
			return {
				mergeTableCells: {
					objectId: op.tableObjectId,
					tableRange: {
						location: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
						rowSpan: op.rowSpan,
						columnSpan: op.columnSpan,
					},
				},
			};

		case 'unmergeTableCells':
			return {
				unmergeTableCells: {
					objectId: op.tableObjectId,
					tableRange: {
						location: { rowIndex: op.rowIndex, columnIndex: op.columnIndex },
						rowSpan: op.rowSpan,
						columnSpan: op.columnSpan,
					},
				},
			};

		case 'replaceAllShapesWithImage':
			return {
				replaceAllShapesWithImage: {
					imageUrl: op.imageUrl,
					containsText: { text: op.containsText, matchCase: op.matchCase ?? false },
					pageObjectIds: op.pageObjectIds,
				},
			};

		case 'replaceAllShapesWithSheetsChart':
			return {
				replaceAllShapesWithSheetsChart: {
					spreadsheetId: op.spreadsheetId,
					chartId: op.chartId,
					linkingMode: op.linkingMode,
					containsText: { text: op.containsText, matchCase: op.matchCase ?? false },
					pageObjectIds: op.pageObjectIds,
				},
			};

		case 'replaceImage':
			return {
				replaceImage: {
					imageObjectId: op.imageObjectId,
					url: op.url,
					replacementMethod: op.replacementMethod,
				},
			};

		case 'updatePageElementTransform':
			return {
				updatePageElementTransform: {
					objectId: op.objectId,
					transform: {
						scaleX: op.scaleX ?? 1,
						scaleY: op.scaleY ?? 1,
						translateX: op.translateX ?? 0,
						translateY: op.translateY ?? 0,
						unit: 'PT',
					},
					applyMode: op.applyMode ?? 'RELATIVE',
				},
			};

		case 'updatePageElementsZOrder':
			return {
				updatePageElementsZOrder: {
					pageElementObjectIds: op.pageElementObjectIds,
					zOrderOperation: op.zOrderOperation,
				},
			};

		case 'updatePageElementAltText':
			return {
				updatePageElementAltText: {
					objectId: op.objectId,
					title: op.title,
					description: op.description,
				},
			};

		case 'groupObjects':
			return {
				groupObjects: {
					childrenObjectIds: op.childrenObjectIds,
					groupObjectId: op.groupObjectId,
				},
			};

		case 'ungroupObjects':
			return {
				ungroupObjects: {
					objectIds: op.objectIds,
				},
			};

		case 'updateShapeProperties': {
			if (!op.shapeBackgroundFillHex) return { updateShapeProperties: { objectId: op.objectId, shapeProperties: {}, fields: '' } };
			const fill: any = { solidFill: { color: { rgbColor: hexToRgb(op.shapeBackgroundFillHex) } } };
			if (op.shapeBackgroundFillAlpha !== undefined) fill.solidFill.alpha = op.shapeBackgroundFillAlpha;
			return {
				updateShapeProperties: {
					objectId: op.objectId,
					shapeProperties: { shapeBackgroundFill: fill },
					fields: 'shapeBackgroundFill'
				},
			};
		}

		case 'updateImageProperties': {
			const props: any = {};
			const fields: string[] = [];
			if (op.brightness !== undefined) { props.brightness = op.brightness; fields.push('imageProperties.brightness'); }
			if (op.contrast !== undefined) { props.contrast = op.contrast; fields.push('imageProperties.contrast'); }
			return {
				updateImageProperties: {
					objectId: op.objectId,
					imageProperties: props,
					fields: fields.join(',') || '*',
				},
			};
		}

		case 'updateVideoProperties': {
			const props: any = {};
			const fields: string[] = [];
			if (op.autoPlay !== undefined) { props.autoPlay = op.autoPlay; fields.push('videoProperties.autoPlay'); }
			if (op.mute !== undefined) { props.mute = op.mute; fields.push('videoProperties.mute'); }
			return {
				updateVideoProperties: {
					objectId: op.objectId,
					videoProperties: props,
					fields: fields.join(',') || '*',
				},
			};
		}

		case 'updateLineProperties': {
			const props: any = {};
			const fields: string[] = [];
			if (op.lineFillHex) { props.lineFill = { solidFill: { color: { rgbColor: hexToRgb(op.lineFillHex) } } }; fields.push('lineProperties.lineFill.solidFill.color'); }
			if (op.weight !== undefined) { props.weight = { magnitude: op.weight, unit: 'PT' }; fields.push('lineProperties.weight'); }
			if (op.dashStyle) {
				props.dashStyle = op.dashStyle; fields.push('lineProperties.dashStyle')
					;
			}
			return {
				updateLineProperties: {
					objectId: op.objectId,
					lineProperties: props,
					fields: fields.join(',') || '*',
				},
			};
		}

		case 'updateLineCategory':
			return {
				updateLineCategory: {
					objectId: op.objectId,
					lineCategory: op.lineCategory,
				},
			};

		case 'rerouteLine':
			return {
				rerouteLine: {
					objectId: op.objectId,
				},
			};

		case 'refreshSheetsChart':
			return {
				refreshSheetsChart: {
					objectIds: op.objectIds,
				},
			};

		default:
			throw new Error(`Unknown slides operation: ${(op as any).op}`);
	}
}

// ── Programmatic slide rendering ──────────────────────────────────────────
// The AI supplies content (text, palette, image keywords).
// Code handles ALL pixel positions — no AI coordinate guessing.

let _uid = 0;
function uid(prefix: string): string {
	return `${prefix}_${(++_uid).toString().padStart(3, '0')}_${Date.now().toString(36).slice(-4)}`;
}

function pollinationsUrl(description: string): string {
	return `https://image.pollinations.ai/prompt/${encodeURIComponent(description)}?width=1280&height=720&nologo=true`;
}

function renderTitleSlide(slideId: string, slide: TitleSlide, p: Palette): SlidesOperation[] {
	const titleId = uid('tit');
	const subtitleId = uid('sub');
	const dividerId = uid('div');
	const barId = uid('bar');
	const imageId = uid('img');
	const ops: SlidesOperation[] = [];

	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.bg });

	// Decorative shapes
	ops.push({ op: 'createShape', objectId: dividerId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 5, height: 405, translateX: 360, translateY: 0 });
	ops.push({ op: 'createShape', objectId: barId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 360, height: 5, translateX: 0, translateY: 390 });

	// Text boxes
	ops.push({ op: 'createShape', objectId: titleId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 325, height: 130, translateX: 18, translateY: 100 });
	ops.push({ op: 'createShape', objectId: subtitleId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 325, height: 75, translateX: 18, translateY: 245 });

	// Image (IMAGE ZONE: x ≥ 365)
	if (slide.image) {
		ops.push({ op: 'createImage', objectId: imageId, pageObjectId: slideId, url: pollinationsUrl(slide.image), width: 355, height: 405, translateX: 365, translateY: 0 });
	}

	// Text content
	ops.push({ op: 'insertText', objectId: titleId, text: slide.title, insertionIndex: 0 });
	ops.push({ op: 'insertText', objectId: subtitleId, text: slide.subtitle || '', insertionIndex: 0 });

	// Styles
	ops.push({ op: 'updateTextStyle', objectId: titleId, bold: true, fontFamily: 'Oswald', fontSize: 42, foregroundColorHex: '#FFFFFF' });
	ops.push({ op: 'updateParagraphStyle', objectId: titleId, alignment: 'START' });
	ops.push({ op: 'updateTextStyle', objectId: subtitleId, bold: false, fontFamily: 'Lato', fontSize: 20, foregroundColorHex: p.subtle });
	ops.push({ op: 'updateParagraphStyle', objectId: subtitleId, alignment: 'START' });

	// Fill rectangles
	ops.push({ op: 'updateShapeProperties', objectId: dividerId, shapeBackgroundFillHex: p.accent });
	ops.push({ op: 'updateShapeProperties', objectId: barId, shapeBackgroundFillHex: p.accent });

	return ops;
}

function renderContentSlide(slideId: string, slide: ContentSlide, p: Palette): SlidesOperation[] {
	const topBarId = uid('top');
	const dividerId = uid('div');
	const labelId = uid('lbl');
	const titleId = uid('tit');
	const bodyId = uid('bod');
	const imageId = uid('img');
	const ops: SlidesOperation[] = [];

	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.bg });

	// Decorative shapes
	ops.push({ op: 'createShape', objectId: topBarId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 360, height: 6, translateX: 0, translateY: 0 });
	ops.push({ op: 'createShape', objectId: dividerId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 5, height: 405, translateX: 360, translateY: 0 });

	// Text boxes
	if (slide.label) {
		ops.push({ op: 'createShape', objectId: labelId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 250, height: 24, translateX: 20, translateY: 18 });
	}
	ops.push({ op: 'createShape', objectId: titleId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 330, height: 65, translateX: 15, translateY: 48 });
	ops.push({ op: 'createShape', objectId: bodyId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 330, height: 270, translateX: 15, translateY: 122 });

	// Image
	if (slide.image) {
		ops.push({ op: 'createImage', objectId: imageId, pageObjectId: slideId, url: pollinationsUrl(slide.image), width: 340, height: 360, translateX: 368, translateY: 22 });
	}

	// Text content
	if (slide.label) {
		ops.push({ op: 'insertText', objectId: labelId, text: slide.label.toUpperCase(), insertionIndex: 0 });
	}
	ops.push({ op: 'insertText', objectId: titleId, text: slide.title, insertionIndex: 0 });
	ops.push({ op: 'insertText', objectId: bodyId, text: (slide.bullets ?? []).join('\n'), insertionIndex: 0 });

	// Styles
	if (slide.label) {
		ops.push({ op: 'updateTextStyle', objectId: labelId, bold: false, fontFamily: 'Lato', fontSize: 12, foregroundColorHex: p.accent });
		ops.push({ op: 'updateParagraphStyle', objectId: labelId, alignment: 'START' });
	}
	ops.push({ op: 'updateTextStyle', objectId: titleId, bold: true, fontFamily: 'Oswald', fontSize: 26, foregroundColorHex: '#FFFFFF' });
	ops.push({ op: 'updateParagraphStyle', objectId: titleId, alignment: 'START' });
	ops.push({ op: 'updateTextStyle', objectId: bodyId, bold: false, fontFamily: 'Lato', fontSize: 16, foregroundColorHex: '#E0E0E0' });
	ops.push({ op: 'updateParagraphStyle', objectId: bodyId, alignment: 'START', lineSpacing: 130 });
	ops.push({ op: 'createParagraphBullets', objectId: bodyId, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' });

	// Fill rectangles
	ops.push({ op: 'updateShapeProperties', objectId: topBarId, shapeBackgroundFillHex: p.accent });
	ops.push({ op: 'updateShapeProperties', objectId: dividerId, shapeBackgroundFillHex: p.accent });

	return ops;
}

function renderConclusionSlide(slideId: string, slide: ConclusionSlide, p: Palette): SlidesOperation[] {
	const topBarId = uid('top');
	const botBarId = uid('bot');
	const leftBarId = uid('lft');
	const statementId = uid('stm');
	const ctaId = uid('cta');
	const ops: SlidesOperation[] = [];

	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.bg });

	// Full-width accent bars top + bottom, left edge bar
	ops.push({ op: 'createShape', objectId: topBarId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 720, height: 8, translateX: 0, translateY: 0 });
	ops.push({ op: 'createShape', objectId: botBarId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 720, height: 8, translateX: 0, translateY: 397 });
	ops.push({ op: 'createShape', objectId: leftBarId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 8, height: 389, translateX: 0, translateY: 8 });

	// Text (full-width, centered)
	ops.push({ op: 'createShape', objectId: statementId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 160, translateX: 70, translateY: 105 });
	if (slide.cta) {
		ops.push({ op: 'createShape', objectId: ctaId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 60, translateX: 70, translateY: 278 });
	}

	ops.push({ op: 'insertText', objectId: statementId, text: slide.statement, insertionIndex: 0 });
	if (slide.cta) {
		ops.push({ op: 'insertText', objectId: ctaId, text: slide.cta, insertionIndex: 0 });
	}

	ops.push({ op: 'updateTextStyle', objectId: statementId, bold: true, fontFamily: 'Oswald', fontSize: 38, foregroundColorHex: '#FFFFFF' });
	ops.push({ op: 'updateParagraphStyle', objectId: statementId, alignment: 'CENTER' });
	if (slide.cta) {
		ops.push({ op: 'updateTextStyle', objectId: ctaId, bold: false, fontFamily: 'Lato', fontSize: 20, foregroundColorHex: p.subtle });
		ops.push({ op: 'updateParagraphStyle', objectId: ctaId, alignment: 'CENTER' });
	}

	ops.push({ op: 'updateShapeProperties', objectId: topBarId, shapeBackgroundFillHex: p.accent });
	ops.push({ op: 'updateShapeProperties', objectId: botBarId, shapeBackgroundFillHex: p.accent });
	ops.push({ op: 'updateShapeProperties', objectId: leftBarId, shapeBackgroundFillHex: p.accent });

	return ops;
}

function renderHighlightSlide(slideId: string, slide: HighlightSlide, p: Palette): SlidesOperation[] {
	const ops: SlidesOperation[] = [];
	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.bg });

	// Full-bleed image on right half
	if (slide.image) {
		const imgId = uid('img');
		ops.push({ op: 'createImage', objectId: imgId, pageObjectId: slideId, url: pollinationsUrl(slide.image), width: 355, height: 405, translateX: 365, translateY: 0 });
	}

	// Vertical accent bar
	const divId = uid('div');
	ops.push({ op: 'createShape', objectId: divId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 5, height: 405, translateX: 360, translateY: 0 });
	ops.push({ op: 'updateShapeProperties', objectId: divId, shapeBackgroundFillHex: p.accent });

	// Optional label
	if (slide.label) {
		const lblId = uid('lbl');
		ops.push({ op: 'createShape', objectId: lblId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 300, height: 24, translateX: 20, translateY: 16 });
		ops.push({ op: 'insertText', objectId: lblId, text: slide.label.toUpperCase(), insertionIndex: 0 });
		ops.push({ op: 'updateTextStyle', objectId: lblId, bold: false, fontFamily: 'Lato', fontSize: 11, foregroundColorHex: p.accent });
		ops.push({ op: 'updateParagraphStyle', objectId: lblId, alignment: 'START' });
	}

	// Stats grid — up to 3 stats across the left half
	const stats = (slide.stats ?? []).slice(0, 3);
	const slotH = Math.floor(340 / Math.max(stats.length, 1));
	stats.forEach((stat, i) => {
		const valId = uid('val');
		const capId = uid('cap');
		const yBase = 45 + i * slotH;
		ops.push({ op: 'createShape', objectId: valId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 330, height: 70, translateX: 15, translateY: yBase });
		ops.push({ op: 'createShape', objectId: capId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 330, height: 30, translateX: 15, translateY: yBase + 68 });
		ops.push({ op: 'insertText', objectId: valId, text: stat.value, insertionIndex: 0 });
		ops.push({ op: 'insertText', objectId: capId, text: stat.caption, insertionIndex: 0 });
		ops.push({ op: 'updateTextStyle', objectId: valId, bold: true, fontFamily: 'Oswald', fontSize: 52, foregroundColorHex: p.accent });
		ops.push({ op: 'updateParagraphStyle', objectId: valId, alignment: 'START' });
		ops.push({ op: 'updateTextStyle', objectId: capId, bold: false, fontFamily: 'Lato', fontSize: 14, foregroundColorHex: '#CCCCCC' });
		ops.push({ op: 'updateParagraphStyle', objectId: capId, alignment: 'START' });
	});

	return ops;
}

function renderQuoteSlide(slideId: string, slide: QuoteSlide, p: Palette): SlidesOperation[] {
	const ops: SlidesOperation[] = [];
	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.bg });

	// Full-bleed image (the semi-transparent overlay below provides the dim effect)
	if (slide.image) {
		const imgId = uid('img');
		ops.push({ op: 'createImage', objectId: imgId, pageObjectId: slideId, url: pollinationsUrl(slide.image), width: 720, height: 405, translateX: 0, translateY: 0 });
	}

	// Semi-transparent overlay strip behind quote
	const overlayId = uid('ovl');
	ops.push({ op: 'createShape', objectId: overlayId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 720, height: 230, translateX: 0, translateY: 88 });
	ops.push({ op: 'updateShapeProperties', objectId: overlayId, shapeBackgroundFillHex: p.bg, shapeBackgroundFillAlpha: 0.82 });

	// Accent bar left
	const barId = uid('bar');
	ops.push({ op: 'createShape', objectId: barId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 6, height: 190, translateX: 55, translateY: 105 });
	ops.push({ op: 'updateShapeProperties', objectId: barId, shapeBackgroundFillHex: p.accent });

	// Quote text
	const quoteId = uid('qot');
	ops.push({ op: 'createShape', objectId: quoteId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 150, translateX: 75, translateY: 105 });
	ops.push({ op: 'insertText', objectId: quoteId, text: `"${slide.quote}"`, insertionIndex: 0 });
	ops.push({ op: 'updateTextStyle', objectId: quoteId, bold: false, fontFamily: 'Lora', fontSize: 24, foregroundColorHex: '#FFFFFF' });
	ops.push({ op: 'updateParagraphStyle', objectId: quoteId, alignment: 'START', lineSpacing: 140 });

	// Attribution
	if (slide.attribution) {
		const attrId = uid('atr');
		ops.push({ op: 'createShape', objectId: attrId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 30, translateX: 75, translateY: 262 });
		ops.push({ op: 'insertText', objectId: attrId, text: `— ${slide.attribution}`, insertionIndex: 0 });
		ops.push({ op: 'updateTextStyle', objectId: attrId, bold: false, fontFamily: 'Lato', fontSize: 14, foregroundColorHex: p.subtle });
		ops.push({ op: 'updateParagraphStyle', objectId: attrId, alignment: 'START' });
	}

	return ops;
}

function renderSectionSlide(slideId: string, slide: SectionSlide, p: Palette): SlidesOperation[] {
	const ops: SlidesOperation[] = [];
	ops.push({ op: 'updatePageProperties', objectId: slideId, pageBackgroundFillHex: p.accent });

	// Large number/icon top-left
	if (slide.number) {
		const numId = uid('num');
		ops.push({ op: 'createShape', objectId: numId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 200, height: 120, translateX: 60, translateY: 80 });
		ops.push({ op: 'insertText', objectId: numId, text: slide.number, insertionIndex: 0 });
		ops.push({ op: 'updateTextStyle', objectId: numId, bold: true, fontFamily: 'Oswald', fontSize: 96, foregroundColorHex: '#FFFFFF' });
		ops.push({ op: 'updateParagraphStyle', objectId: numId, alignment: 'START' });
	}

	// Section title
	const titleId = uid('tit');
	const titleY = slide.number ? 210 : 140;
	ops.push({ op: 'createShape', objectId: titleId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 80, translateX: 60, translateY: titleY });
	ops.push({ op: 'insertText', objectId: titleId, text: slide.title, insertionIndex: 0 });
	ops.push({ op: 'updateTextStyle', objectId: titleId, bold: true, fontFamily: 'Oswald', fontSize: 40, foregroundColorHex: '#FFFFFF' });
	ops.push({ op: 'updateParagraphStyle', objectId: titleId, alignment: 'START' });

	// Teaser line
	if (slide.teaser) {
		const teasId = uid('tea');
		ops.push({ op: 'createShape', objectId: teasId, pageObjectId: slideId, shapeType: 'TEXT_BOX', width: 580, height: 40, translateX: 60, translateY: titleY + 82 });
		ops.push({ op: 'insertText', objectId: teasId, text: slide.teaser, insertionIndex: 0 });
		ops.push({ op: 'updateTextStyle', objectId: teasId, bold: false, fontFamily: 'Lato', fontSize: 18, foregroundColorHex: '#FFFFFF' });
		ops.push({ op: 'updateParagraphStyle', objectId: teasId, alignment: 'START' });
	}

	// Bottom white bar for contrast
	const botId = uid('bot');
	ops.push({ op: 'createShape', objectId: botId, pageObjectId: slideId, shapeType: 'RECTANGLE', width: 720, height: 6, translateX: 0, translateY: 399 });
	ops.push({ op: 'updateShapeProperties', objectId: botId, shapeBackgroundFillHex: '#FFFFFF', shapeBackgroundFillAlpha: 0.3 });

	return ops;
}

function renderSlide(slideId: string, spec: SlideSpec, palette: Palette): SlidesOperation[] {
	switch (spec.type) {
		case 'title': return renderTitleSlide(slideId, spec, palette);
		case 'content': return renderContentSlide(slideId, spec, palette);
		case 'highlight': return renderHighlightSlide(slideId, spec, palette);
		case 'quote': return renderQuoteSlide(slideId, spec, palette);
		case 'section': return renderSectionSlide(slideId, spec, palette);
		case 'conclusion': return renderConclusionSlide(slideId, spec, palette);
	}
}

// ── Batch executor: images run individually so one bad URL can't kill the deck

async function executeBatchWithImageFallback(
	slidesApi: ReturnType<typeof google.slides>,
	presentationId: string,
	ops: SlidesOperation[],
	prefixRequests: any[] = [],
): Promise<void> {
	const imageOps = ops.filter((o) => o.op === 'createImage');
	const otherOps = ops.filter((o) => o.op !== 'createImage');

	const mainRequests = [...prefixRequests, ...otherOps.map((o) => buildRequest(o)).flat()];
	if (mainRequests.length > 0) {
		await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests: mainRequests } });
	}

	for (const imgOp of imageOps) {
		try {
			await slidesApi.presentations.batchUpdate({
				presentationId,
				requestBody: { requests: [buildRequest(imgOp)].flat() },
			});
		} catch (err) {
			console.warn(`[slides] Image skipped (${(imgOp as any).url}): ${(err as Error).message}`);
		}
	}
}

// ── Create presentation using AI content + programmatic rendering ──────────

export async function createPresentationWithDesign(
	title: string,
	topics: string[],
	oauthClient: unknown,
	claudeKey: string,
): Promise<{ presentationId: string; url: string; slideCount: number }> {
	const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });

	// Step 1: AI generates content + palette (no pixel positions)
	const contentPrompt = buildSlidesContentPrompt(title, topics);
	const deck = await callClaudeForContent(contentPrompt, claudeKey);
	const palette = deck.palette ?? { bg: '#0D1B2A', accent: '#E2B04A', subtle: '#94A3B8' };

	// Step 2: Create blank presentation, get initial slide ID
	const created = await slidesApi.presentations.create({ requestBody: { title: deck.title || title } });
	const presentationId = created.data.presentationId!;

	const pres = await slidesApi.presentations.get({ presentationId });
	const initialSlide = pres.data.slides![0];
	const initialSlideId = initialSlide.objectId!;

	// Step 3: Delete default placeholder elements
	const cleanupRequests = (initialSlide.pageElements ?? [])
		.filter((el) => el.objectId)
		.map((el) => ({ deleteObject: { objectId: el.objectId! } }));

	// Step 4: Render each slide programmatically
	const slides = deck.slides ?? [];
	const allOps: SlidesOperation[] = [];

	slides.forEach((spec: SlideSpec, index: number) => {
		let slideId: string;
		if (index === 0) {
			// Reuse the blank slide Google already created
			slideId = initialSlideId;
		} else {
			slideId = uid('slide');
			allOps.push({ op: 'createSlide', objectId: slideId, insertionIndex: index, layout: 'BLANK', placeholderIdMappings: [] });
		}
		allOps.push(...renderSlide(slideId, spec, palette));
	});

	// Step 5: Execute — images attempted individually so failures don't abort the deck
	await executeBatchWithImageFallback(slidesApi, presentationId, allOps, cleanupRequests);

	return {
		presentationId,
		url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
		slideCount: slides.length,
	};
}

// ── App-level entry point (called by app-router) ──────────────────────────

export async function handleSlidesCommand(
	command: string,
	oauthClient: unknown,
	active: ActiveWorkspace,
	_geminiKey: string | undefined,
): Promise<ParseRouteResult> {
	const apiKey = process.env.CLAUDE_API_KEY;
	if (!apiKey) throw new Error('CLAUDE_API_KEY is not configured');

	const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });

	let activeContext = '';
	let slideCount = 0;
	const googleIds = new Set<string>();
	if (active.presentation) {
		try {
			const meta = await slidesApi.presentations.get({ presentationId: active.presentation.id });
			slideCount = meta.data.slides?.length ?? 0;

			// Extract background color of slide 1 for theme matching
			const slide1 = meta.data.slides?.[0];
			const s1bg = slide1?.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor;
			const themeColor = s1bg
				? `#${[s1bg.red ?? 0, s1bg.green ?? 0, s1bg.blue ?? 0].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
				: null;

			const slideList = (meta.data.slides ?? []).map((s, index) => {
				if (s.objectId) googleIds.add(s.objectId);

				const bg = s.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor;
				const bgHex = bg
					? `#${[bg.red ?? 0, bg.green ?? 0, bg.blue ?? 0].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
					: 'none';

				const elements = (s.pageElements ?? []).map((el) => {
					if (el.objectId) googleIds.add(el.objectId);

					// Convert transform/size from EMU to PT (1 PT = 12700 EMU)
					const unit = el.transform?.unit ?? 'EMU';
					const f = unit === 'PT' ? 1 : 1 / 12700;
					const x = Math.round((el.transform?.translateX ?? 0) * f);
					const y = Math.round((el.transform?.translateY ?? 0) * f);
					const su = el.size?.width?.unit ?? 'EMU';
					const sf = su === 'PT' ? 1 : 1 / 12700;
					const w = Math.round((el.size?.width?.magnitude ?? 0) * sf);
					const h = Math.round((el.size?.height?.magnitude ?? 0) * sf);

					let kind = 'UNKNOWN';
					let extra = '';
					if (el.image) {
						kind = 'IMAGE';
					} else if (el.shape) {
						kind = el.shape.shapeType ?? 'SHAPE';
						if (el.shape.text) {
							const txt = el.shape.text.textElements?.map(te => te.textRun?.content ?? '').join('').trim();
							if (txt) extra = `, text: "${txt.slice(0, 60)}"`;
						}
					} else if (el.line) {
						kind = 'LINE';
					}

					return `  [${kind}] id:${el.objectId} pos=(${x},${y}) size=${w}x${h}${extra}`;
				});

				return `Slide ${index + 1} (id: ${s.objectId}, bg:${bgHex})\n${elements.join('\n')}`;
			});

			const themeNote = themeColor
				? `\nTHEME: background=${themeColor} — match this EXACTLY when adding new slides. Infer accent color from any colored RECTANGLE elements on slide 1.`
				: '';
			activeContext = `Active presentation — "${active.presentation.title}" (id: ${active.presentation.id})${themeNote}\nCanvas: 720×405 PT\n\n${slideList.join('\n\n')}`;
		} catch {
			activeContext = `Active presentation — "${active.presentation.title}" (id: ${active.presentation.id})`;
		}
	} else {
		activeContext = 'No active presentation. You can only create a new presentation.';
	}

	const prompt = buildSlidesPrompt(command, activeContext);
	const intent = await callClaudeForIntent(prompt, apiKey);

	// ── CREATE ──────────────────────────────────────────────────────────
	if (intent.intent === 'create') {
		const title = intent.title?.trim() || 'Untitled Presentation';
		const slidePrompts = intent.slide_prompts?.length ? intent.slide_prompts : ['Title slide', 'Overview', 'Key Points', 'Conclusion'];

		const { url, slideCount: createdSlideCount } = await createPresentationWithDesign(title, slidePrompts, oauthClient, apiKey);

		return {
			action: 'create_presentation',
			title,
			url,
			fileType: 'slides',
			summary: `Created presentation "${title}" with ${createdSlideCount} slides.`,
		};
	}

	// ── EDIT ─────────────────────────────────────────────────────────────
	if (!active.presentation) {
		throw new Error('No active presentation to edit. Create one first or open a presentation.');
	}

	const presentationId = active.presentation.id;
	const ops = intent.operations ?? [];

	if (ops.length === 0) {
		return {
			action: 'edit_presentation',
			title: active.presentation.title,
			url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
			fileType: 'slides',
			summary: 'No operations were needed for that command.',
		};
	}

	const safeOps = enforceMinIdLength(ops, googleIds) as SlidesOperation[];
	let currentSlideCount = slideCount;
	const normalizedOps = safeOps.map((op) => {
		if (op.op === 'createSlide' && op.insertionIndex !== undefined) {
			op.insertionIndex = Math.min(op.insertionIndex, currentSlideCount);
			currentSlideCount++;
		}
		return op;
	});

	await executeBatchWithImageFallback(slidesApi, presentationId, normalizedOps);

	const opSummary = ops.map((o) => o.op).join(', ');
	return {
		action: 'edit_presentation',
		title: active.presentation.title,
		url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
		fileType: 'slides',
		summary: `Updated presentation: ${opSummary}`,
	};
}
