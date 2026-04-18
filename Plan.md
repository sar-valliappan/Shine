# WorkspaceCLI — Technical Implementation Plan
> A Warp-style browser terminal for Google Workspace, powered by Gemini AI

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Repo Structure](#4-repo-structure)
5. [Environment Variables](#5-environment-variables)
6. [Member Responsibilities](#6-member-responsibilities)
7. [Feature Specification](#7-feature-specification)
8. [Frontend — Terminal UI](#8-frontend--terminal-ui)
9. [Gemini AI Engine](#9-gemini-ai-engine)
10. [Google Workspace API Integration](#10-google-workspace-api-integration)

---

## 1. Project Overview

**WorkspaceCLI** is a browser-based terminal that lets users control their entire Google Workspace using natural language commands. The user types a plain-English command; Gemini 1.5 Flash parses it into a structured action; the backend executes that action against the appropriate Google Workspace API and returns a result card to the terminal.

### Data Flow

```
User types command
      │
      ▼
Frontend sends raw string → POST /api/parse
      │
      ▼
Gemini 1.5 Flash (function calling)
  → returns structured JSON action
      │
      ▼
Workspace API Router
  → routes to /api/docs, /api/sheets, /api/drive, /api/gmail
      │
      ▼
Google Workspace API call (with user OAuth token)
      │
      ▼
Returns { url, title, summary } to frontend
      │
      ▼
Terminal renders output block with clickable file link
```

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React App)                     │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Terminal UI (Warp-style)               │   │
│   │   AGENT $ [natural language input]                  │   │
│   │   ─────────────────────────────────────────────     │   │
│   │   ✓ Created: "Q2 Budget" · Google Sheets            │   │
│   │     → https://docs.google.com/spreadsheets/...      │   │
│   └─────────────────────────────────────────────────────┘   │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Node.js / Express Backend                  │
│                                                             │
│   ┌──────────────────┐    ┌──────────────────────────────┐  │
│   │  Gemini 1.5 Flash│    │    Google OAuth2 Handler     │  │
│   │  Command Parser  │    │    Token Store / Refresh     │  │
│   └──────────────────┘    └──────────────────────────────┘  │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              Workspace API Router                    │  │
│   │  /docs   /sheets   /drive   /gmail   /slides         │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Google Workspace APIs                     │
│   Docs API · Sheets API · Drive API · Gmail API             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

### Frontend

| Package | Purpose |
|---|---|
| React 18 + TypeScript | Core UI framework |
| Vite | Build tool and dev server |
| xterm.js | Terminal emulator component |
| Tailwind CSS | Styling |
| ElevenLabs JS SDK | Voice readback of results |
| Web Speech API | Voice input (browser built-in) |

### AI Layer

| Package | Purpose |
|---|---|
| `@google/generative-ai` | Gemini 1.5 Flash API client |
| Gemini function calling | Maps NL input to typed Workspace actions |

### Backend

| Package | Purpose |
|---|---|
| Node.js 20 + Express 4 | HTTP server and routing |
| `googleapis` | All Google Workspace API calls |
| `google-auth-library` | OAuth2 client, token refresh |
| `express-session` | Session storage for OAuth tokens |

---

## 4. Repo Structure

```
workspacecli/
├── PLAN.md
├── .env.example
├── .gitignore
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Terminal.tsx          # Main terminal component
│   │   │   ├── CommandBlock.tsx      # Individual command + output block
│   │   │   ├── OutputCard.tsx        # Formatted result card
│   │   │   ├── LoadingIndicator.tsx  # AI thinking animation
│   │   │   └── AuthButton.tsx        # Google sign-in button
│   │   ├── hooks/
│   │   │   ├── useCommandHistory.ts  # Arrow-key navigation through past commands
│   │   │   └── useTerminal.ts        # Core terminal state machine
│   │   ├── services/
│   │   │   ├── api.ts                # Backend HTTP client (fetch wrappers)
│   │   │   └── elevenlabs.ts         # TTS voice readback
│   │   ├── styles/
│   │   │   └── terminal.css          # Spy theme — dark bg, AGENT $ prompt
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── backend/
    ├── src/
    │   ├── routes/
    │   │   ├── auth.ts               # Google OAuth2 flow (/api/auth/*)
    │   │   ├── parse.ts              # Gemini parse endpoint (/api/parse)
    │   │   ├── docs.ts               # Google Docs API (/api/docs/*)
    │   │   ├── sheets.ts             # Google Sheets API (/api/sheets/*)
    │   │   ├── drive.ts              # Google Drive API (/api/drive/*)
    │   │   └── gmail.ts              # Gmail API (/api/gmail/*)
    │   ├── services/
    │   │   ├── gemini.ts             # Gemini client + function calling setup
    │   │   └── googleAuth.ts         # OAuth2 client factory, token refresh
    │   ├── prompts/
    │   │   ├── commandParser.ts      # System prompt: NL → action JSON
    │   │   └── contentGenerator.ts   # Prompts for generating Doc/Sheet content
    │   ├── types/
    │   │   └── actions.ts            # WorkspaceAction discriminated union types
    │   └── index.ts                  # Express app entry point
    ├── package.json
    └── tsconfig.json
```

---

## 5. Environment Variables

```bash
# backend/.env

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/callback

GEMINI_API_KEY=

ELEVENLABS_API_KEY=

PORT=3001
SESSION_SECRET=
```

```bash
# frontend/.env

VITE_API_BASE_URL=http://localhost:3001
VITE_ELEVENLABS_API_KEY=
```

---

## 7. Feature Specification

### Must-Have (MVP)

- [ ] Terminal input with `AGENT $` prompt
- [ ] Natural language command parsing via Gemini 1.5 Flash
- [ ] Create Google Docs with Gemini-generated content
- [ ] Create Google Sheets with Gemini-generated data and formulas
- [ ] List and search Google Drive files
- [ ] Google OAuth2 login flow
- [ ] Output block with clickable link to the created file
- [ ] Command history (arrow keys navigate previous commands)
- [ ] Error handling with readable messages
- [ ] Deployed on live URL

### Should-Have

- [ ] Create Gmail drafts
- [ ] ElevenLabs TTS voice readback on command completion
- [ ] Loading/thinking animation while Gemini processes
- [ ] Spy theme: dark terminal, `AGENT $` prompt, mission-language copy
- [ ] Autocomplete suggestions for common commands

### Nice-to-Have

- [ ] Voice input via Web Speech API
- [ ] Edit existing documents (`update the Q2 budget, add a row for marketing`)
- [ ] Create Google Slides presentations
- [ ] Share files via terminal (`share <filename> with <email>`)

---

## 8. Frontend — Terminal UI

### Terminal.tsx

The top-level terminal component. Manages the list of command blocks and the active input.

```tsx
interface TerminalState {
  blocks: CommandBlock[];
  inputValue: string;
  isProcessing: boolean;
}

interface CommandBlock {
  id: string;
  input: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  output?: WorkspaceResult;
  error?: string;
  timestamp: number;
}
```

- Renders a scrollable list of `<CommandBlock>` components
- Keeps a single active `<input>` at the bottom with `AGENT $` prefix
- On Enter: appends a new block with `status: 'loading'`, calls `api.parseCommand(input)`, updates block on resolve/reject
- Auto-scrolls to bottom on new block

### CommandBlock.tsx

Renders one command and its result.

```tsx
// Input line (always shown)
<div className="command-input">
  <span className="prompt">AGENT $</span>
  <span className="command-text">{block.input}</span>
</div>

// Output (shown after response)
{block.status === 'loading' && <LoadingIndicator />}
{block.status === 'success' && <OutputCard result={block.output} />}
{block.status === 'error'   && <ErrorCard message={block.error} />}
```

### OutputCard.tsx

Renders the result of a successful command.

```tsx
interface WorkspaceResult {
  action: string;       // e.g. "create_document"
  title: string;        // e.g. "Q2 Budget"
  url: string;          // Direct Google link
  summary?: string;     // Short description of what was created
  fileType: 'doc' | 'sheet' | 'drive' | 'gmail' | 'list';
  items?: DriveFile[];  // For list/search results
}
```

- Shows `✓ Created: "{title}"` with file type icon
- Renders clickable URL
- For list results, renders a small file table

### useCommandHistory.ts

```typescript
export function useCommandHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const push = (cmd: string) => {
    setHistory(prev => [cmd, ...prev]);
    setHistoryIndex(-1);
  };

  const navigate = (direction: 'up' | 'down'): string | null => {
    // ArrowUp → older commands, ArrowDown → newer
    // Returns the command string to populate the input
  };

  return { push, navigate };
}
```

### api.ts

```typescript
const BASE = import.meta.env.VITE_API_BASE_URL;

export async function parseCommand(input: string): Promise<WorkspaceResult> {
  const res = await fetch(`${BASE}/api/parse`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: input }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkAuth(): Promise<boolean> {
  const res = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' });
  return res.ok;
}

export function getAuthUrl(): string {
  return `${BASE}/api/auth/google`;
}
```

---

## 9. Gemini AI Engine

### Action Types

```typescript
// backend/src/types/actions.ts

export type WorkspaceAction =
  | { action: 'create_document';    title: string; content_prompt: string; sections: string[] }
  | { action: 'create_spreadsheet'; title: string; headers: string[]; rows: any[][]; include_formulas: boolean }
  | { action: 'list_files';         query?: string; limit: number }
  | { action: 'search_drive';       query: string }
  | { action: 'create_draft';       to: string; subject: string; body_prompt: string }
  | { action: 'clarify';            question: string }
```

### Gemini Function Definitions

```typescript
// backend/src/services/gemini.ts

const workspaceFunctions = [
  {
    name: 'create_document',
    description: 'Creates a new Google Doc with AI-generated content',
    parameters: {
      type: 'object',
      properties: {
        title:          { type: 'string' },
        content_prompt: { type: 'string', description: 'Detailed prompt for generating the document body' },
        sections:       { type: 'array', items: { type: 'string' }, description: 'List of section headings' },
      },
      required: ['title', 'content_prompt'],
    },
  },
  {
    name: 'create_spreadsheet',
    description: 'Creates a new Google Sheet with structured data and optional formulas',
    parameters: {
      type: 'object',
      properties: {
        title:            { type: 'string' },
        headers:          { type: 'array', items: { type: 'string' } },
        rows:             { type: 'array', items: { type: 'array' } },
        include_formulas: { type: 'boolean' },
      },
      required: ['title', 'headers', 'rows'],
    },
  },
  {
    name: 'list_files',
    description: 'Lists recent files from Google Drive',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional MIME type filter' },
        limit: { type: 'number' },
      },
      required: ['limit'],
    },
  },
  {
    name: 'search_drive',
    description: 'Searches Google Drive for files matching a query',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_draft',
    description: 'Creates a Gmail draft with AI-generated body',
    parameters: {
      type: 'object',
      properties: {
        to:          { type: 'string' },
        subject:     { type: 'string' },
        body_prompt: { type: 'string', description: 'Prompt describing what the email should say' },
      },
      required: ['to', 'subject', 'body_prompt'],
    },
  },
  {
    name: 'clarify',
    description: 'Ask the user for clarification when the command is ambiguous',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
      required: ['question'],
    },
  },
];
```

## 10. Google Workspace API Integration

### OAuth2 Setup

```typescript
// backend/src/services/googleAuth.ts

import { google } from 'googleapis';

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
];
```

### Auth Routes

```typescript
// backend/src/routes/auth.ts

router.get('/google', (req, res) => {
  const client = createOAuthClient();
  const url = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code as string);
  req.session.tokens = tokens;
  res.redirect(process.env.FRONTEND_URL ?? 'http://localhost:5173');
});

router.get('/status', (req, res) => {
  res.sendStatus(req.session.tokens ? 200 : 401);
});
```

### Auth Middleware

```typescript
// backend/src/middleware/authMiddleware.ts

export function requireAuth(req, res, next) {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: 'Not authenticated. Visit /api/auth/google' });
  }
  const client = createOAuthClient();
  client.setCredentials(req.session.tokens);
  req.oauthClient = client;
  next();
}
```

### Google Docs API

```typescript
// backend/src/routes/docs.ts

router.post('/create', requireAuth, async (req, res) => {
  const { title, content } = req.body;
  const docs = google.docs({ version: 'v1', auth: req.oauthClient });

  const doc = await docs.documents.create({ requestBody: { title } });
  const documentId = doc.data.documentId!;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index: 1 }, text: content } }],
    },
  });

  res.json({
    title,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
    fileType: 'doc',
  });
});
```

### Google Sheets API

```typescript
// backend/src/routes/sheets.ts

router.post('/create', requireAuth, async (req, res) => {
  const { title, headers, rows } = req.body;
  const sheets = google.sheets({ version: 'v4', auth: req.oauthClient });

  const toCell = (val: any) =>
    typeof val === 'number'
      ? { userEnteredValue: { numberValue: val } }
      : String(val).startsWith('=')
      ? { userEnteredValue: { formulaValue: val } }
      : { userEnteredValue: { stringValue: String(val) } };

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [
            { values: headers.map((h: string) => toCell(h)) },
            ...rows.map((row: any[]) => ({ values: row.map(toCell) })),
          ],
        }],
      }],
    },
  });

  res.json({
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheet.data.spreadsheetId}/edit`,
    fileType: 'sheet',
  });
});
```

### Google Drive API

```typescript
// backend/src/routes/drive.ts

router.get('/list', requireAuth, async (req, res) => {
  const { query, limit = 10 } = req.query;
  const drive = google.drive({ version: 'v3', auth: req.oauthClient });

  const response = await drive.files.list({
    q: query as string | undefined,
    pageSize: Number(limit),
    fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
    orderBy: 'modifiedTime desc',
  });

  res.json({ items: response.data.files, fileType: 'list' });
});

router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  const drive = google.drive({ version: 'v3', auth: req.oauthClient });

  const response = await drive.files.list({
    q: `fullText contains '${q}' or name contains '${q}'`,
    pageSize: 10,
    fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
  });

  res.json({ items: response.data.files, fileType: 'list' });
});
```

### Gmail API

```typescript
// backend/src/routes/gmail.ts

router.post('/draft', requireAuth, async (req, res) => {
  const { to, subject, body } = req.body;
  const gmail = google.gmail({ version: 'v1', auth: req.oauthClient });

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\n');

  const encoded = Buffer.from(message).toString('base64url');

  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: encoded } },
  });

  res.json({
    title: subject,
    url: `https://mail.google.com/mail/#drafts/${draft.data.id}`,
    fileType: 'gmail',
    summary: `Draft to ${to}`,
  });
});
```

---
