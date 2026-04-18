import { Router } from 'express';
import { google } from 'googleapis';
import { parseCommand } from '../services/gemini';
import { generateDocumentContent, generateEmailBody } from '../prompts/contentGenerator';
import { requireAuth } from '../middleware/authMiddleware';
import type { WorkspaceResult, DriveFile } from '../types/actions';

const router = Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command is required' });
    }

    const action = await parseCommand(command);
    const oauthClient = (req as any).oauthClient;

    switch (action.action) {
      case 'create_document': {
        const content = await generateDocumentContent(
          action.title,
          action.content_prompt,
          action.sections ?? [],
        );
        const docs = google.docs({ version: 'v1', auth: oauthClient });
        const doc = await docs.documents.create({ requestBody: { title: action.title } });
        const documentId = doc.data.documentId!;
        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          },
        });
        const result: WorkspaceResult = {
          action: 'create_document',
          title: action.title,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
          fileType: 'doc',
          summary: `Created document: ${action.title}`,
        };
        return res.json(result);
      }

      case 'create_spreadsheet': {
        const sheets = google.sheets({ version: 'v4', auth: oauthClient });

        const toCell = (val: any) =>
          typeof val === 'number'
            ? { userEnteredValue: { numberValue: val } }
            : String(val).startsWith('=')
            ? { userEnteredValue: { formulaValue: val } }
            : { userEnteredValue: { stringValue: String(val) } };

        const rowData = [
          { values: action.headers.map((h: string) => toCell(h)) },
          ...action.rows.map((row: any[]) => ({ values: row.map(toCell) })),
        ];

        if (action.include_formulas && action.rows.length > 0) {
          const formulaRow = action.headers.map((_: string, i: number) => {
            const col = String.fromCharCode(65 + i);
            const isNumeric = action.rows.some((r: any[]) => typeof r[i] === 'number');
            return isNumeric
              ? toCell(`=SUM(${col}2:${col}${action.rows.length + 1})`)
              : toCell('');
          });
          rowData.push({ values: formulaRow });
        }

        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: action.title },
            sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData }] }],
          },
        });
        const result: WorkspaceResult = {
          action: 'create_spreadsheet',
          title: action.title,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheet.data.spreadsheetId}/edit`,
          fileType: 'sheet',
          summary: `Created spreadsheet: ${action.title} (${action.headers.length} columns)`,
        };
        return res.json(result);
      }

      case 'create_draft': {
        const body = await generateEmailBody(action.subject, action.body_prompt);
        const gmail = google.gmail({ version: 'v1', auth: oauthClient });
        const raw = Buffer.from(
          [`To: ${action.to}`, `Subject: ${action.subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
        ).toString('base64url');
        const draft = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw } },
        });
        const result: WorkspaceResult = {
          action: 'create_draft',
          title: action.subject,
          url: `https://mail.google.com/mail/#drafts/${draft.data.id}`,
          fileType: 'gmail',
          summary: `Draft saved: "${action.subject}" to ${action.to}`,
        };
        return res.json(result);
      }

      case 'send_email': {
        const body = await generateEmailBody(action.subject, action.body_prompt);
        const gmail = google.gmail({ version: 'v1', auth: oauthClient });
        const raw = Buffer.from(
          [`To: ${action.to}`, `Subject: ${action.subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'),
        ).toString('base64url');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        const result: WorkspaceResult = {
          action: 'send_email',
          title: action.subject,
          url: 'https://mail.google.com/mail/#sent',
          fileType: 'gmail',
          summary: `Sent: "${action.subject}" to ${action.to}`,
        };
        return res.json(result);
      }

      case 'list_files': {
        const drive = google.drive({ version: 'v3', auth: oauthClient });
        const response = await drive.files.list({
          q: action.query,
          pageSize: action.limit,
          fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
          orderBy: 'modifiedTime desc',
        });
        const result: WorkspaceResult = {
          action: 'list_files',
          title: 'Recent Files',
          url: 'https://drive.google.com',
          fileType: 'list',
          items: (response.data.files ?? []) as DriveFile[],
        };
        return res.json(result);
      }

      case 'search_drive': {
        const drive = google.drive({ version: 'v3', auth: oauthClient });
        const escaped = action.query.replace(/'/g, "\\'");
        const response = await drive.files.list({
          q: `fullText contains '${escaped}' or name contains '${escaped}'`,
          pageSize: 10,
          fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
        });
        const result: WorkspaceResult = {
          action: 'search_drive',
          title: `Search: "${action.query}"`,
          url: 'https://drive.google.com',
          fileType: 'list',
          items: (response.data.files ?? []) as DriveFile[],
        };
        return res.json(result);
      }

      case 'clarify': {
        const result: WorkspaceResult = {
          action: 'clarify',
          title: 'Clarification needed',
          url: '',
          fileType: 'clarify',
          summary: action.question,
        };
        return res.json(result);
      }

      default:
        return res.status(501).json({ error: `Action '${(action as any).action}' is not yet implemented` });
    }
  } catch (err: any) {
    console.error('[/api/parse] error:', err);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

export default router;
