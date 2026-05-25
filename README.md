# Shine — WorkspaceCLI (Best Use of Gemini API, Citrus Hack 2026)

> A Warp-style browser terminal for Google Workspace, powered by Gemini AI 
---
[Devpost](https://devpost.com/software/shine-9xh5l8)

## What It Does

Shine lets you control your entire Google Workspace through natural language commands in a sleek, browser-based terminal. Type a plain-English command like *"create a Q2 budget spreadsheet with formulas"* or *"draft an email to the team about tomorrow's standup"* — and Shine executes it instantly, returning a clickable link to the result.

No clicking through menus. No switching tabs. Just a terminal and intent.

---

## Tech Stack

### Frontend
| Technology | Role |
|---|---|
| **React 18 + TypeScript** | Core UI framework with full type safety |
| **Vite** | Lightning-fast build tool and dev server |
| **xterm.js** | Terminal emulator component rendering the Warp-style UI |
| **Tailwind CSS** | Utility-first styling with a dark spy-terminal aesthetic |
| **ElevenLabs JS SDK** | Voice readback of command results via TTS |
| **Web Speech API** | Browser-native voice input for hands-free commands |

### AI Layer
| Technology | Role |
|---|---|
| **Gemini 2.5 Flash** | Natural language command parser via `@google/generative-ai` |
| **Gemini Function Calling** | Maps free-form input to structured, typed Workspace actions |

### Backend
| Technology | Role |
|---|---|
| **Node.js 20 + Express 4** | HTTP server and API routing |
| **Google APIs Node.js Client (`googleapis`)** | Calls to Docs, Sheets, Drive, Gmail, Slides, Calendar, and Forms APIs |
| **`google-auth-library`** | OAuth2 client with token refresh |
| **`express-session`** | Session-based token storage |

### Google Workspace APIs Integrated
- Google Docs API
- Google Sheets API (with formula support)
- Google Drive API
- Gmail API
- Google Slides API
- Google Calendar API
- Google Forms API

---

## Architecture

```
User types command
      │
      ▼
Frontend (React + xterm.js) → POST /api/parse
      │
      ▼
Gemini 2.5 Flash (function calling)
  → returns structured JSON action
      │
      ▼
Workspace API Router
  → routes to /api/docs | /api/sheets | /api/drive | /api/gmail
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

**System architecture diagram:**

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React App)                     │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Terminal UI (Warp-style)               │   │
│   │   AGENT $ create a Q2 budget spreadsheet            │   │
│   │   ─────────────────────────────────────────────     │   │
│   │   ✓ Created: "Q2 Budget" · Google Sheets            │   │
│   │     → https://docs.google.com/spreadsheets/...      │   │
│   └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Node.js / Express Backend                  │
│   ┌──────────────────┐    ┌──────────────────────────────┐  │
│   │  Gemini 2.5 Flash│    │    Google OAuth2 Handler     │  │
│   │  Command Parser  │    │    Token Store / Refresh     │  │
│   └──────────────────┘    └──────────────────────────────┘  │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  Workspace API Router                                │  │
│   │  /docs   /sheets   /drive   /gmail   /slides         │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Google Workspace APIs                     │
│   Docs · Sheets · Drive · Gmail · Slides · Calendar · Forms │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Features

### Natural Language Command Parsing
Gemini 2.5 Flash receives the raw command string and uses **function calling** to return a strongly-typed `WorkspaceAction` discriminated union — mapping intent to a precise API operation with no ambiguity.

**Supported actions (`backend/src/types/actions.ts`):**

| Action | Description |
|---|---|
| `create_document` | Create a new Google Doc with AI-generated content |
| `edit_document` | Edit an existing Doc — add/insert/delete sections, replace text, insert tables, style text, set font, insert page breaks, rewrite, rename, or undo |
| `create_spreadsheet` | Create a new Google Sheet with headers, rows, and optional formulas |
| `edit_spreadsheet` | Edit an existing Sheet — add rows or columns |
| `create_presentation` | Create a Google Slides deck with AI-authored slide content |
| `edit_presentation` | Edit an existing presentation — add, edit, or delete slides |
| `create_form` | Create a Google Form with typed questions (short text, paragraph, multiple choice, checkbox, dropdown, linear scale, date, time) |
| `edit_form` | Edit an existing Form — add/delete questions, update title or description |
| `create_event` | Schedule a Google Calendar event with optional location and description |
| `create_draft` | Create a Gmail draft with AI-generated body |
| `edit_draft` | Edit an existing Gmail draft |
| `send_email` | Send an email via Gmail with AI-generated body |
| `share_file` | Share any Workspace file with one or more recipients, with configurable role (reader, commenter, writer) and optional notification message |
| `list_files` | List recent Google Drive files with optional filters |
| `search_drive` | Full-text search across Google Drive |
| `clarify` | Ask the user a follow-up question when the command is ambiguous |

### Google Sheets with Formula Support
The Sheets API integration intelligently detects formula strings and maps them to the correct cell type:

```typescript
const toCell = (val: any) =>
  typeof val === 'number'
    ? { userEnteredValue: { numberValue: val } }
    : String(val).startsWith('=')
    ? { userEnteredValue: { formulaValue: val } }
    : { userEnteredValue: { stringValue: String(val) } };
```

### Warp-Style Terminal UI
Built with `xterm.js` and a custom `useCommandHistory` hook for arrow-key navigation through past commands — matching the UX of developer-grade terminal tools.

### Voice I/O
- **Input:** Web Speech API for hands-free command entry
- **Output:** ElevenLabs TTS reads back results on completion

### Google OAuth2 Flow
Full OAuth2 implementation with offline access for token refresh, scoped to only the Workspace permissions required:

```typescript
export const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
];
```

---

## Project Structure

```
shine/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Terminal.tsx          # Main terminal state machine
│   │   │   ├── CommandBlock.tsx      # Individual command + output block
│   │   │   ├── OutputCard.tsx        # Formatted result card with file link
│   │   │   ├── LoadingIndicator.tsx  # AI thinking animation
│   │   │   └── AuthButton.tsx        # Google OAuth sign-in
│   │   ├── hooks/
│   │   │   ├── useCommandHistory.ts  # Arrow-key navigation through history
│   │   │   └── useTerminal.ts        # Terminal state machine
│   │   └── services/
│   │       ├── api.ts                # Backend HTTP client
│   │       └── elevenlabs.ts         # TTS voice readback
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts               # Google OAuth2 flow
│   │   │   ├── parse.ts              # Gemini parse endpoint
│   │   │   ├── docs.ts               # Google Docs API
│   │   │   ├── sheets.ts             # Google Sheets API
│   │   │   ├── drive.ts              # Google Drive API
│   │   │   └── gmail.ts              # Gmail API
│   │   ├── services/
│   │   │   ├── gemini.ts             # Gemini client + function calling
│   │   │   └── googleAuth.ts         # OAuth2 factory and token refresh
│   │   ├── prompts/
│   │   │   ├── commandParser.ts      # NL → action JSON system prompt
│   │   │   └── contentGenerator.ts   # Prompts for generating file content
│   │   └── types/
│   │       └── actions.ts            # WorkspaceAction discriminated union
├── .env.example
└── README.md
```

---

## Installation and Setup

### Prerequisites
- Node.js 20+
- A Google Cloud project with Workspace APIs enabled
- A Gemini API key
- An ElevenLabs API key (optional, for voice readback)

### Environment Variables

```bash
# backend/.env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/callback
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
PORT=3001
SESSION_SECRET=

# frontend/.env
VITE_API_BASE_URL=http://localhost:3001
VITE_ELEVENLABS_API_KEY=
```

### Run Locally

```bash
# Clone the repo
git clone https://github.com/sar-valliappan/Shine.git
cd Shine

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Start backend (from /backend)
npm run dev

# Start frontend (from /frontend)
npm run dev
```

Open `http://localhost:5173` and sign in with Google to begin.

---

## Example Commands

```
AGENT $ create a Q2 budget spreadsheet with revenue, expenses, and net profit columns
AGENT $ draft an email to alex@company.com about the new product launch timeline
AGENT $ list my 10 most recently modified Drive files
AGENT $ make a Google Doc with a 30-60-90 day onboarding plan for a new engineer
AGENT $ schedule a team standup tomorrow at 9am for 30 minutes
AGENT $ create a feedback form with 5 questions about the last sprint
AGENT $ create a 5-slide pitch deck for a B2B SaaS product
AGENT $ add a row to the Q2 budget spreadsheet for marketing spend
```

---

## Skills Demonstrated

### Full-Stack TypeScript Development
End-to-end application built entirely in TypeScript — from typed API routes and OAuth middleware on the Express backend to strongly-typed React components and custom hooks on the frontend. Every layer of the stack is type-safe.

### AI / LLM Integration
Practical implementation of Gemini 2.5 Flash's **function calling** feature to parse free-form natural language into structured, executable actions — handling ambiguity gracefully with a `clarify` fallback action rather than failing silently.

### Google Workspace API Integration
Hands-on integration across seven distinct Google APIs (Docs, Sheets, Drive, Gmail, Slides, Calendar, Forms), each with its own data model and authentication pattern. Includes formula-aware cell mapping for Sheets and base64url MIME encoding for Gmail drafts.

### OAuth2 Authentication
Complete Google OAuth2 implementation covering the full flow: authorization URL generation, callback handling, token storage, and credential refresh — secured via Express session middleware.

### System Design
Clean separation of concerns between the AI parsing layer (Gemini), the routing layer (Express), and the execution layer (Google APIs). The `WorkspaceAction` discriminated union enforces type safety across all three layers.

### UI/UX Engineering
Warp-style terminal built with `xterm.js`, command history navigation with arrow keys, async loading states, and voice I/O via two separate APIs (Web Speech for input, ElevenLabs for output).

---

## Planned Enhancements

- File sharing: *"share the roadmap doc with the engineering team"*
- Autocomplete suggestions for common commands
- Keyboard shortcuts for power users
