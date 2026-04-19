import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/authMiddleware.js';
import { enrichDriveFile } from '../workspace/drivePreview.js';

const router = Router();

interface DriveFile {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  webViewLink?: string | null;
  modifiedTime?: string | null;
  embedUrl?: string;
}

interface ListFilesQuery {
  query?: string;
  limit?: string;
}

interface SearchQuery {
  q?: string;
}

/**
 * GET /api/drive/list
 * Lists recent files from Google Drive with optional query filter
 */
router.get('/list', requireAuth, async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.query as ListFilesQuery;
    const pageSize = Math.min(Math.max(parseInt(limit || '10'), 1), 100);

    // Create Google Drive API client
    const drive = google.drive({ version: 'v3', auth: req.oauthClient });

    // Build query: either use provided query or just list recent files
    let q = 'trashed = false';
    if (query) {
      q = `${q} and (name contains '${query.replace(/'/g, "\\'")}' or fullText contains '${query.replace(/'/g, "\\'")}')`; 
    }

    const response = await drive.files.list({
      q,
      pageSize,
      fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
      orderBy: 'modifiedTime desc',
    });

    const items: DriveFile[] = (response.data.files || []).map((file) => enrichDriveFile({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      modifiedTime: file.modifiedTime,
    }));

    res.json({
      items,
      fileType: 'list',
      count: items.length,
    });
  } catch (error) {
    console.error('Error listing Google Drive files:', error);
    const message = error instanceof Error ? error.message : 'Failed to list files';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/drive/search
 * Searches Google Drive for files matching a query
 */
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const { q } = req.query as SearchQuery;

    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    // Create Google Drive API client
    const drive = google.drive({ version: 'v3', auth: req.oauthClient });

    // Search for files
    const response = await drive.files.list({
      q: `trashed = false and (name contains '${q.replace(/'/g, "\\'")}' or fullText contains '${q.replace(/'/g, "\\'")}')`  ,
      pageSize: 20,
      fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
    });

    const items: DriveFile[] = (response.data.files || []).map((file) => enrichDriveFile({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      modifiedTime: file.modifiedTime,
    }));

    res.json({
      items,
      fileType: 'list',
      count: items.length,
      query: q,
    });
  } catch (error) {
    console.error('Error searching Google Drive:', error);
    const message = error instanceof Error ? error.message : 'Failed to search files';
    res.status(500).json({ error: message });
  }
});

export default router;
