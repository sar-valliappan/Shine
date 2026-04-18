import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

interface CreateSheetRequest {
  title?: string;
  headers?: string[];
  rows?: any[][];
  includeFormulas?: boolean;
}

/**
 * Helper function to convert a cell value to Google Sheets cell format
 */
function toSheetCell(val: any, includeFormulas: boolean = false) {
  if (typeof val === 'number') {
    return { userEnteredValue: { numberValue: val } };
  }

  const strVal = String(val);
  if (includeFormulas && strVal.startsWith('=')) {
    return { userEnteredValue: { formulaValue: strVal } };
  }

  return { userEnteredValue: { stringValue: strVal } };
}

/**
 * POST /api/sheets/create
 * Creates a new Google Sheet with headers and rows
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, headers, rows, includeFormulas } = req.body as CreateSheetRequest;

    // Validate input
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Missing or invalid title' });
    }

    if (!Array.isArray(headers) || headers.length === 0) {
      return res.status(400).json({ error: 'Headers must be a non-empty array' });
    }

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Rows must be an array' });
    }

    // Create Google Sheets API client
    const sheets = google.sheets({ version: 'v4', auth: req.oauthClient });

    // Convert headers and rows to sheet cell format
    const headerRow = {
      values: headers.map((h) => toSheetCell(h, false)),
    };

    const dataRows = rows.map((row) => ({
      values: Array.isArray(row) ? row.map((cell) => toSheetCell(cell, includeFormulas)) : [],
    }));

    // Create spreadsheet with data
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: title.trim(),
        },
        sheets: [
          {
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [headerRow, ...dataRows],
              },
            ],
          },
        ],
      },
    });

    const spreadsheetId = createResponse.data.spreadsheetId;

    if (!spreadsheetId) {
      return res.status(500).json({ error: 'Failed to create spreadsheet in Google Drive' });
    }

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    res.json({
      action: 'create_spreadsheet',
      title: title.trim(),
      url,
      fileType: 'sheet',
      summary: `Created Google Sheet: ${title.trim()} with ${headers.length} columns and ${rows.length} rows`,
    });
  } catch (error) {
    console.error('Error creating Google Sheet:', error);
    const message = error instanceof Error ? error.message : 'Failed to create spreadsheet';
    res.status(500).json({ error: message });
  }
});

export default router;
