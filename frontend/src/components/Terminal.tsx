import { useState, useRef, useEffect, useCallback } from 'react';
import {
  parseCommand as parseWorkspaceCommand,
  extractGoogleWorkspaceFileIdFromUrl,
  getAuthStatus,
  getGoogleAuthUrl,
  getGmailDraft,
  updateGmailDraft,
  sendGmailDraft,
  updateCalendarEvent,
} from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────
type AppKey = 'docs' | 'sheets' | 'slides' | 'gmail' | 'forms' | 'calendar' | 'sites' | 'classroom' | 'drive';

interface AppDef {
  label: string;
  accent: string;
  ext: string;
  path: string;
}

interface DocState {
  app: AppKey;
  title: string;
  slug: string;
  content: unknown;
  url?: string;
  previewUrl?: string;
}

type WorkspaceParseResult = {
  action?: string;
  title?: string;
  url?: string;
  embedUrl?: string;
  summary?: string;
  fileType?: string;
  items?: Array<any>;
  eventId?: string;
  calendarId?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
};

interface DocsContent { h: string; p: string; }
interface SheetsContent { headers: string[]; rows: string[][]; }
interface SlidesContent { title: string; sub: string; }
interface GmailContent { to: string; subject: string; body: string; }
interface FormsQuestion { q: string; type: 'scale' | 'long' | 'yesno'; }
interface FormsContent { title: string; description: string; questions: FormsQuestion[]; }
interface CalendarContent {
  summary: string;
  details?: string;
  eventId?: string;
  calendarId?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
}
interface SiteBlock { kind: 'hero' | 'grid' | 'text'; title?: string; body?: string; items?: string[]; }
interface SitesContent { title: string; blocks: SiteBlock[]; }
interface Assignment { title: string; due: string; points: number; }
interface ClassroomContent { title: string; section: string; assignments: Assignment[]; students: number; }
interface DriveItem { id?: string; name: string; kind: string; modified: string; mimeType?: string; webViewLink?: string; url?: string; embedUrl?: string; }
interface DriveContent { items: DriveItem[]; }

interface Block {
  id: string;
  input: string;
  status: 'loading' | 'success' | 'error';
  kind?: 'help' | 'ack';
  msg?: string;
  ackAccent?: string;
  error?: string;
  ctxDoc: DocState | null;
  promptAccent: string;
}

interface Tweaks {
  density: 'cozy' | 'compact';
  chrome: boolean;
  sidebar: 'right' | 'below';
  paneWidth: number;
}

// ── Constants ─────────────────────────────────────────────────────────────
const APPS: Record<AppKey, AppDef> = {
  docs:      { label: 'docs',      accent: '#4285F4', ext: 'doc',   path: 'docs' },
  sheets:    { label: 'sheets',    accent: '#34A853', ext: 'sheet', path: 'sheets' },
  slides:    { label: 'slides',    accent: '#FBBC05', ext: 'deck',  path: 'slides' },
  gmail:     { label: 'gmail',     accent: '#EA4335', ext: 'draft', path: 'gmail' },
  forms:     { label: 'forms',     accent: '#673AB7', ext: 'form',  path: 'forms' },
  calendar:  { label: 'calendar',  accent: '#0B57D0', ext: 'event', path: 'calendar' },
  sites:     { label: 'sites',     accent: '#512DA8', ext: 'site',  path: 'sites' },
  classroom: { label: 'classroom', accent: '#0F9D58', ext: 'class', path: 'classroom' },
  drive:     { label: 'drive',     accent: 'multi',   ext: 'list',  path: 'drive' },
};
const DRIVE_MIX = ['#FBBC05', '#4285F4', '#34A853', '#EA4335'];
const DEFAULT_ACCENT = '#ffffff';

// ── Helpers ───────────────────────────────────────────────────────────────
function slug(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 28) || 'untitled';
}
function titleCase(s: string) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }
function accentFor(appKey: AppKey | undefined): string {
  if (!appKey) return DEFAULT_ACCENT;
  const a = APPS[appKey];
  if (!a) return DEFAULT_ACCENT;
  if (a.accent === 'multi') return DRIVE_MIX[0];
  return a.accent;
}
function isMultiApp(appKey: AppKey | undefined) { return !!appKey && APPS[appKey]?.accent === 'multi'; }

function googlePreviewUrl(app: AppKey, url?: string): string | undefined {
  if (!url) return undefined;
  
  // Return the live editing URL for embedded views
  // Google Docs, Sheets, and Slides can be embedded with the /edit URL
  // Forms /edit is blocked cross-origin in iframes — use the respondent view for preview
  if (app === 'forms') {
    return url.replace(/\/edit(?:\?.*)?$/, '/viewform?embedded=true');
  }

  if (app === 'calendar') {
    return 'https://calendar.google.com/calendar/embed?src=primary&mode=AGENDA';
  }

  // For docs, sheets, slides - return the edit URL which supports live embedding
  return url;
}

function driveItemKey(item?: DriveItem | null): string {
  if (!item) return '';
  return item.id || item.webViewLink || item.url || item.name;
}

function driveItemPreviewUrl(item: DriveItem): string | undefined {
  return item.url || item.webViewLink || item.embedUrl;
}

function driveItemOpenUrl(item: DriveItem): string | undefined {
  return item.url || item.webViewLink || item.embedUrl;
}

// ── Seed content ──────────────────────────────────────────────────────────
function seedDocContent(topic: string): DocsContent[] {
  const t = topic.toLowerCase();
  if (t.includes('plan')) return [
    { h: 'Overview', p: 'This document outlines the plan for ' + topic + ' across the coming quarter.' },
    { h: 'Goals', p: 'Ship three flagship features. Reduce onboarding time by 40%. Grow activated users by 25%.' },
    { h: 'Timeline', p: 'Kickoff apr 22 · milestone 1 may 20 · milestone 2 jun 17 · launch jul 08.' },
    { h: 'Risks', p: 'Scope creep on analytics integration. Design review bandwidth. Vendor SLA on data warehouse.' },
  ];
  return [
    { h: 'Introduction', p: titleCase(topic) + ' is a short working document meant to frame the conversation before the next review.' },
    { h: 'Details', p: 'Add context, data, and decisions here as the work progresses.' },
    { h: 'Next steps', p: 'Assign owners, circulate for comments, schedule the sync.' },
  ];
}
function seedSheetContent(topic: string): SheetsContent {
  const t = topic.toLowerCase();
  if (t.includes('budget')) return {
    headers: ['category', 'planned', 'actual', 'delta'],
    rows: [
      ['Headcount', '$820,000', '$798,400', '-$21,600'],
      ['Infrastructure', '$142,000', '$156,800', '+$14,800'],
      ['Marketing', '$220,000', '$204,100', '-$15,900'],
      ['Travel', '$48,000', '$52,600', '+$4,600'],
      ['Tools', '$64,000', '$61,200', '-$2,800'],
    ],
  };
  if (t.includes('hir') || t.includes('candidate')) return {
    headers: ['name', 'role', 'stage', 'date'],
    rows: [
      ['Alex Rivera', 'Product design', 'Onsite', 'apr 22'],
      ['Priya Shah', 'Staff engineer', 'Offer', 'apr 19'],
      ['Jordan Lee', 'Growth PM', 'Screen', 'apr 25'],
      ['Maya Chen', 'Design eng', 'Portfolio', 'apr 23'],
    ],
  };
  return {
    headers: ['item', 'owner', 'status', 'date'],
    rows: [
      ['Kickoff sync', 'Priya', 'Scheduled', 'apr 22'],
      ['Research plan', 'Maya', 'In review', 'apr 24'],
      ['Draft copy', 'Jordan', 'Blocked', 'apr 26'],
    ],
  };
}
function seedSlidesContent(topic: string): SlidesContent[] {
  return [
    { title: titleCase(topic), sub: 'Q2 2026 review' },
    { title: 'Context', sub: 'Where we started · what changed · what matters now' },
    { title: 'Results', sub: '3 flagship launches · +42% activations · 94 NPS' },
    { title: 'What worked', sub: 'Cross-team pods · weekly releases · public roadmap' },
    { title: 'Next quarter', sub: 'Focus · bets · horizons' },
  ];
}
function seedGmailContent(topic: string, to?: string): GmailContent {
  return {
    to: to || 'team@company.com',
    subject: titleCase(topic),
    body: ['Hi team,', '', 'Wanted to share a quick update on ' + topic + '. We hit the milestones for this sprint and are lining up next week.', '', 'Summary:', '• Launched v2 to 15% of users', '• Fixed the long-standing import bug', '• Kicked off research on onboarding', '', 'Let me know if you have questions.', '', 'Thanks,'].join('\n'),
  };
}
function seedFormContent(topic: string): FormsContent {
  return {
    title: titleCase(topic),
    description: "We'd love 2 minutes of your time.",
    questions: [
      { q: 'How satisfied were you?', type: 'scale' },
      { q: 'What worked well?', type: 'long' },
      { q: 'What could be better?', type: 'long' },
      { q: 'Would you recommend us?', type: 'yesno' },
    ],
  };
}
function seedCalendarContent(topic: string, result?: WorkspaceParseResult): CalendarContent {
  return {
    summary: result?.title || titleCase(topic),
    details: 'Edit details below and save to update this event.',
    eventId: result?.eventId,
    calendarId: result?.calendarId,
    start_time: result?.start_time,
    end_time: result?.end_time,
    location: result?.location,
    description: result?.description,
  };
}
function seedDriveContent(): DriveContent {
  return {
    items: [
      { name: 'q2 budget', kind: 'sheets', modified: '2h ago' },
      { name: 'board deck — apr', kind: 'slides', modified: '5h ago' },
      { name: 'onboarding plan', kind: 'docs', modified: 'yesterday' },
      { name: 'hiring tracker', kind: 'sheets', modified: '2d ago' },
      { name: 'brand guidelines v3', kind: 'docs', modified: '3d ago' },
      { name: 'customer interviews', kind: 'docs', modified: '1w ago' },
      { name: 'launch video', kind: 'drive', modified: '1w ago' },
      { name: 'team site', kind: 'sites', modified: '2w ago' },
    ],
  };
}

// ── Parser ────────────────────────────────────────────────────────────────
type ParseResult =
  | { type: 'help' }
  | { type: 'clear' }
  | { type: 'close' }
  | { type: 'open' }
  | { type: 'ls' }
  | { type: 'edit'; op: string; value: string };

const GLOBAL_CMDS: { test: RegExp; run: (m: RegExpMatchArray) => ParseResult }[] = [
  { test: /^(help|\?|commands)$/i, run: () => ({ type: 'help' }) },
  { test: /^clear$/i, run: () => ({ type: 'clear' }) },
  { test: /^(exit|close|quit)$/i, run: () => ({ type: 'close' }) },
  { test: /^open$/i, run: () => ({ type: 'open' }) },
  { test: /^ls$/i, run: () => ({ type: 'ls' }) },
];

function parseContextCmd(input: string, app: AppKey): ParseResult | null {
  const lower = input.trim();
  let m = lower.match(/^(rename|title)\s+(to\s+)?(.+)$/i);
  if (m) return { type: 'edit', op: 'rename', value: m[3].trim() };
  m = lower.match(/^add\s+(section|heading)\s+(.+)$/i);
  if (m && app === 'docs') return { type: 'edit', op: 'addSection', value: m[2].trim() };
  m = lower.match(/^add\s+row\s+(.+)$/i);
  if (m && app === 'sheets') return { type: 'edit', op: 'addRow', value: m[1].trim() };
  m = lower.match(/^add\s+(slide|chapter)\s+(titled|called\s+)?(.+)$/i);
  if (m && app === 'slides') return { type: 'edit', op: 'addSlide', value: m[3].trim() };
  m = lower.match(/^add\s+question\s+(.+)$/i);
  if (m && app === 'forms') return { type: 'edit', op: 'addQuestion', value: m[1].trim().replace(/^"|"$/g, '') };
  m = lower.match(/^add\s+assignment\s+(.+)$/i);
  if (m && app === 'classroom') return { type: 'edit', op: 'addAssignment', value: m[1].trim() };
  m = lower.match(/^to\s+(.+)$/i);
  if (m && app === 'gmail') return { type: 'edit', op: 'setTo', value: m[1].trim() };
  m = lower.match(/^subject\s+(.+)$/i);
  if (m && app === 'gmail') return { type: 'edit', op: 'setSubject', value: m[1].trim() };
  m = lower.match(/^append\s+(.+)$/i);
  if (m) return { type: 'edit', op: 'append', value: m[1].trim() };
  return null;
}

function parseLocalCommand(input: string, openApp: AppKey | undefined): ParseResult | null {
  for (const c of GLOBAL_CMDS) {
    const m = input.match(c.test);
    if (m) return c.run(m);
  }
  if (openApp) {
    const ctx = parseContextCmd(input, openApp);
    if (ctx) return ctx;
  }
  return null;
}

function appFromFileType(fileType: string | undefined): AppKey | null {
  if (!fileType) return null;
  if (fileType === 'doc') return 'docs';
  if (fileType === 'sheet') return 'sheets';
  if (fileType === 'slides') return 'slides';
  if (fileType === 'gmail') return 'gmail';
  if (fileType === 'form') return 'forms';
  if (fileType === 'calendar') return 'calendar';
  if (fileType === 'drive' || fileType === 'list') return 'drive';
  return null;
}

function docFromWorkspaceResult(result: WorkspaceParseResult, input: string): DocState | null {
  const app = appFromFileType(result?.fileType);
  if (!app) return null;

  const title = (result?.title || result?.summary || input || 'untitled').toString();
  const normalizedTitle = titleCase(title);

  if (app === 'drive') {
    const items = Array.isArray(result?.items)
      ? result.items.map((item: any) => ({
          id: item?.id,
          name: item?.name || item?.title || 'untitled',
          kind: item?.mimeType?.includes('spreadsheet')
            ? 'sheets'
            : item?.mimeType?.includes('presentation')
              ? 'slides'
              : item?.mimeType?.includes('document')
                ? 'docs'
                : item?.mimeType?.includes('form')
                  ? 'forms'
                  : item?.mimeType?.includes('folder')
                    ? 'drive'
                : 'drive',
          modified: item?.modifiedTime ? 'recently' : 'unknown',
          mimeType: item?.mimeType,
          webViewLink: item?.webViewLink,
          url: item?.url || item?.webViewLink,
          embedUrl: item?.embedUrl,
        }))
      : seedDriveContent().items;

    return {
      app: 'drive',
      title: 'Drive files',
      slug: 'drive',
      content: { items },
    };
  }

  if (app === 'docs' || app === 'sheets' || app === 'slides' || app === 'forms') {
    return {
      app,
      title: normalizedTitle,
      slug: slug(normalizedTitle),
      content:
        app === 'docs' ? seedDocContent(normalizedTitle)
        : app === 'sheets' ? seedSheetContent(normalizedTitle)
        : app === 'slides' ? seedSlidesContent(normalizedTitle)
        : seedFormContent(normalizedTitle),
      url: result?.url,
      previewUrl: result?.embedUrl || googlePreviewUrl(app, result?.url),
    };
  }

  if (app === 'calendar') {
    return {
      app,
      title: normalizedTitle,
      slug: slug(normalizedTitle),
      content: seedCalendarContent(normalizedTitle, result),
      url: result?.url,
      previewUrl: result?.embedUrl || googlePreviewUrl(app, result?.url),
    };
  }

  return {
    app: 'gmail',
    title: normalizedTitle,
    slug: slug(normalizedTitle),
    content: seedGmailContent(normalizedTitle),
    url: result?.url,
  };
}

function buildPath(openDoc: DocState | null): string {
  if (!openDoc) return '~';
  return `~/${APPS[openDoc.app].path}/${openDoc.slug}.${APPS[openDoc.app].ext}`;
}

// ── Prompt ────────────────────────────────────────────────────────────────
function Prompt({ openDoc, accent }: { openDoc: DocState | null; accent: string }) {
  const path = buildPath(openDoc);
  const multi = isMultiApp(openDoc?.app);
  const labelCls = 'prompt-label' + (multi ? ' prompt-multi' : '');
  const sigilCls = 'prompt-sigil' + (multi ? ' prompt-multi' : '');
  const style = multi ? {} : { color: accent };
  return (
    <span className="prompt">
      <span className={labelCls} style={style}>shine</span>
      <span className="prompt-sep">:</span>
      <span className="prompt-path">{path}</span>
      <span className={sigilCls} style={style}>$</span>
    </span>
  );
}

// ── App title editor ──────────────────────────────────────────────────────
function AppTitleEdit({ value, onChange, accent }: { value: string; onChange: (v: string) => void; accent: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="app-title-edit" value={v} style={{ color: accent }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onChange(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      spellCheck={false} />
  );
}

// ── App panes ─────────────────────────────────────────────────────────────
function LiveWorkspaceApp({
  doc,
  accent,
  label,
  fallback,
  frameClassName,
}: {
  doc: DocState;
  accent: string;
  label: string;
  fallback: React.ReactNode;
  frameClassName?: string;
}) {
  const liveUrl = doc.previewUrl || doc.url;
  return (
    <div className="app-surface live-app">
      <div className="app-titlebar" style={{ borderColor: accent }}>
        <span className="app-title-read" style={{ color: accent }}>{doc.title}</span>
        {doc.url ? (
          <a className="app-live-link" href={doc.url} target="_blank" rel="noreferrer">open live</a>
        ) : (
          <span className="app-saved">live preview</span>
        )}
      </div>
      <div className="live-preview-shell">
        {liveUrl ? (
          <iframe
            className={'live-preview-frame' + (frameClassName ? ` ${frameClassName}` : '')}
            src={liveUrl}
            title={label + ': ' + doc.title}
            referrerPolicy="no-referrer-when-downgrade"
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"
          />
        ) : (
          <div className="live-preview-empty">{fallback}</div>
        )}
      </div>
    </div>
  );
}

function DocsApp({ doc }: { doc: DocState; setDoc?: (d: DocState) => void }) {
  const content = doc.content as DocsContent[];
  return (
    <LiveWorkspaceApp
      doc={doc}
      accent={APPS.docs.accent}
      label="Google Docs"
      frameClassName="live-preview-frame-docs"
      fallback={
        <div className="docs-page">
          <h1 className="docs-title">{doc.title}</h1>
          {content.map((s, i) => (
            <div className="docs-section" key={i}>
              <h2 className="docs-h">{s.h}</h2>
              <p className="docs-p">{s.p}</p>
            </div>
          ))}
        </div>
      }
    />
  );
}

function SheetsApp({ doc }: { doc: DocState; setDoc?: (d: DocState) => void }) {
  const content = doc.content as SheetsContent;
  return (
    <LiveWorkspaceApp
      doc={doc}
      accent={APPS.sheets.accent}
      label="Google Sheets"
      fallback={
        <div className="sheets-grid">
          <table>
            <thead>
              <tr>
                <th className="sh-corner"></th>
                {content.headers.map((h, i) => (<th key={i} style={{ color: APPS.sheets.accent }}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {content.rows.map((r, i) => (
                <tr key={i}>
                  <td className="sh-row-num">{i + 1}</td>
                  {r.map((v, j) => (<td key={j}>{v}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}

function SlidesApp({ doc }: { doc: DocState; setDoc?: (d: DocState) => void }) {
  const content = doc.content as SlidesContent[];
  return (
    <LiveWorkspaceApp
      doc={doc}
      accent={APPS.slides.accent}
      label="Google Slides"
      fallback={
        <div className="slides-stack">
          {content.map((s, i) => (
            <div className="slide-card" key={i}>
              <div className="slide-num" style={{ color: APPS.slides.accent }}>{String(i + 1).padStart(2, '0')}</div>
              <div className="slide-inner">
                <div className="slide-title" style={{ color: APPS.slides.accent }}>{s.title}</div>
                <div className="slide-sub">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      }
    />
  );
}

function GmailApp({ doc, setDoc }: { doc: DocState; setDoc?: (d: DocState | null) => void }) {
  const content = doc.content as GmailContent;
  const [draft, setDraft] = useState<GmailContent | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const lastSavedRef = useRef<string>('');

  const extractDraftId = (url?: string): string | null => {
    if (!url) return null;
    const match = url.match(/#drafts\/([^/?]+)/i);
    return match?.[1] || null;
  };

  useEffect(() => {
    const nextDraftId = extractDraftId(doc.url);
    setDraftId(nextDraftId);
  }, [doc.url, doc.title]);

  useEffect(() => {
    if (!draftId) {
      setDraft(null);
      setLoadingDraft(false);
      setSaveState('idle');
      setSaveError(null);
      setSendState('idle');
      setSendError(null);
      lastSavedRef.current = '';
      return;
    }

    let mounted = true;
    setLoadingDraft(true);
    setSaveError(null);
    setSendState('idle');
    setSendError(null);

    getGmailDraft(draftId)
      .then((data) => {
        if (!mounted) return;
        const loadedDraft = {
          to: data.to,
          subject: data.subject,
          body: data.body,
        };
        setDraft(loadedDraft);
        const fingerprint = JSON.stringify(loadedDraft);
        lastSavedRef.current = fingerprint;
        setSaveState('saved');
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setSaveState('error');
        setSaveError(String((err as Error)?.message || 'failed to load draft'));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingDraft(false);
      });

    return () => {
      mounted = false;
    };
  }, [draftId, doc]);

  useEffect(() => {
    if (!draftId || !draft) return;
    const fingerprint = JSON.stringify(draft);
    if (fingerprint === lastSavedRef.current) return;

    setSaveState('saving');
    setSaveError(null);

    const timer = setTimeout(() => {
      updateGmailDraft(draftId, draft)
        .then(() => {
          lastSavedRef.current = fingerprint;
          setSaveState('saved');
        })
        .catch((err: unknown) => {
          setSaveState('error');
          setSaveError(String((err as Error)?.message || 'failed to save draft'));
        });
    }, 700);

    return () => clearTimeout(timer);
  }, [draftId, draft]);

  const activeDraft = draft || content;

  const handleSendDraft = async () => {
    if (!draftId || !activeDraft || loadingDraft) return;

    try {
      setSendState('sending');
      setSendError(null);

      // Ensure latest edits are persisted before sending.
      setSaveState('saving');
      await updateGmailDraft(draftId, activeDraft);
      lastSavedRef.current = JSON.stringify(activeDraft);
      setSaveState('saved');

      await sendGmailDraft(draftId);
      setSendState('sent');
      setTimeout(() => {
        setDoc?.(null);
      }, 250);
    } catch (err: unknown) {
      setSendState('error');
      setSendError(String((err as Error)?.message || 'failed to send draft'));
    }
  };

  return (
    <div className="app-surface">
      <div className="app-titlebar" style={{ borderColor: APPS.gmail.accent }}>
        <span className="app-title-read" style={{ color: APPS.gmail.accent }}>{doc.title}</span>
        {doc.url ? (
          <a className="app-live-link" href={doc.url} target="_blank" rel="noreferrer">open live</a>
        ) : (
          <span className="app-saved">gmail api</span>
        )}
      </div>
      <div className="gmail-live" role="region" aria-label="live gmail data">
        <div className="gmail-live-head">
          <div className="gmail-live-title">gmail</div>
          <div className="gmail-live-mailbox">live via gmail api</div>
        </div>

        {draftId && (
          <div className="gmail-save-state">
            {loadingDraft && 'loading draft...'}
            {!loadingDraft && saveState === 'saving' && 'saving...'}
            {!loadingDraft && saveState === 'saved' && 'saved'}
            {!loadingDraft && saveState === 'error' && (saveError || 'save failed')}
            {!loadingDraft && sendState === 'sending' && ' • sending...'}
            {!loadingDraft && sendState === 'sent' && ' • sent'}
            {!loadingDraft && sendState === 'error' && ` • ${sendError || 'send failed'}`}
          </div>
        )}

        {draftId && !loadingDraft && (
          <div className="gmail-editor">
            <label className="gmail-edit-field">
              <span className="gmail-edit-label">To</span>
              <input
                className="gmail-edit-input"
                value={activeDraft.to}
                onChange={(e) => setDraft({ ...activeDraft, to: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="gmail-edit-field">
              <span className="gmail-edit-label">Subject</span>
              <input
                className="gmail-edit-input"
                value={activeDraft.subject}
                onChange={(e) => setDraft({ ...activeDraft, subject: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="gmail-edit-field gmail-edit-field-body">
              <span className="gmail-edit-label">Body</span>
              <textarea
                className="gmail-edit-textarea"
                value={activeDraft.body}
                onChange={(e) => setDraft({ ...activeDraft, body: e.target.value })}
                spellCheck={false}
              />
            </label>
            <div className="gmail-editor-actions">
              <button
                type="button"
                className="gmail-send-btn"
                onClick={handleSendDraft}
                disabled={loadingDraft || saveState === 'saving' || sendState === 'sending'}
              >
                {sendState === 'sending' ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {!draftId && (
          <div className="gmail-compose">
            <div className="g-field"><span className="g-key">to</span><span className="g-val">{content.to}</span></div>
            <div className="g-field"><span className="g-key">subject</span><span className="g-val">{content.subject}</span></div>
            <div className="g-divider" />
            <pre className="g-body">{content.body}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function FormsApp({ doc }: { doc: DocState; setDoc?: (d: DocState) => void }) {
  const content = doc.content as FormsContent;
  return (
    <LiveWorkspaceApp
      doc={doc}
      accent={APPS.forms.accent}
      label="Google Forms"
      fallback={
        <div className="form-body">
          <div className="form-desc">{content.description}</div>
          {content.questions.map((q, i) => (
            <div className="form-q" key={i}>
              <div className="form-q-num" style={{ color: APPS.forms.accent }}>{i + 1}.</div>
              <div className="form-q-body">
                <div className="form-q-text">{q.q}</div>
                <div className="form-q-type">
                  {q.type === 'scale' && <div className="scale-dots">{[1,2,3,4,5].map(n => <span key={n}>○</span>)}</div>}
                  {q.type === 'long' && <div>___________________________</div>}
                  {q.type === 'yesno' && <div>○ yes &nbsp;&nbsp; ○ no</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      }
    />
  );
}

function CalendarApp({ doc, setDoc }: { doc: DocState; setDoc?: (d: DocState) => void }) {
  const content = doc.content as CalendarContent;
  const [draft, setDraft] = useState<CalendarContent>(content);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  const toLocalInputValue = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const fromLocalInputValue = (localValue: string): string => {
    return new Date(localValue).toISOString();
  };

  const canSave = !!draft.eventId && !!draft.summary?.trim() && !!draft.start_time && !!draft.end_time;

  const handleSave = async () => {
    if (!canSave || !draft.eventId) return;
    if (new Date(draft.end_time!).getTime() <= new Date(draft.start_time!).getTime()) {
      setSaveState('error');
      setSaveError('End time must be after start time.');
      return;
    }

    try {
      setSaveState('saving');
      setSaveError(null);
      const updated = (await updateCalendarEvent(draft.eventId, {
        summary: draft.summary.trim(),
        start_time: draft.start_time!,
        end_time: draft.end_time!,
        location: draft.location || '',
        description: draft.description || '',
        calendarId: draft.calendarId,
      })) as WorkspaceParseResult;

      const nextContent: CalendarContent = {
        ...draft,
        summary: updated.title || draft.summary,
        eventId: updated.eventId || draft.eventId,
        calendarId: updated.calendarId || draft.calendarId,
        start_time: updated.start_time || draft.start_time,
        end_time: updated.end_time || draft.end_time,
        location: updated.location ?? draft.location,
        description: updated.description ?? draft.description,
      };

      setDraft(nextContent);
      setDoc?.({
        ...doc,
        title: updated.title || doc.title,
        content: nextContent,
        url: updated.url || doc.url,
        previewUrl: updated.embedUrl || doc.previewUrl,
      });
      setSaveState('saved');
    } catch (err: unknown) {
      setSaveState('error');
      setSaveError(String((err as Error)?.message || 'Failed to update calendar event'));
    }
  };

  return (
    <div className="app-surface live-app">
      <div className="app-titlebar" style={{ borderColor: APPS.calendar.accent }}>
        <span className="app-title-read" style={{ color: APPS.calendar.accent }}>{doc.title}</span>
        {doc.url ? (
          <a className="app-live-link" href={doc.url} target="_blank" rel="noreferrer">open live</a>
        ) : (
          <span className="app-saved">calendar event</span>
        )}
      </div>

      <div className="gmail-live" role="region" aria-label="calendar event editor">
        <div className="gmail-live-head">
          <div className="gmail-live-title">calendar</div>
          <div className="gmail-live-mailbox">edit event inside panel</div>
        </div>
        <div className="gmail-save-state">
          {saveState === 'saving' && 'saving...'}
          {saveState === 'saved' && 'saved'}
          {saveState === 'error' && (saveError || 'save failed')}
          {saveState === 'idle' && (draft.details || 'Edit details and click Save')}
        </div>

        <div className="gmail-editor">
          <label className="gmail-edit-field">
            <span className="gmail-edit-label">Title</span>
            <input
              className="gmail-edit-input"
              value={draft.summary || ''}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="gmail-edit-field">
            <span className="gmail-edit-label">Start</span>
            <input
              type="datetime-local"
              className="gmail-edit-input"
              value={toLocalInputValue(draft.start_time)}
              onChange={(e) => setDraft({ ...draft, start_time: fromLocalInputValue(e.target.value) })}
            />
          </label>
          <label className="gmail-edit-field">
            <span className="gmail-edit-label">End</span>
            <input
              type="datetime-local"
              className="gmail-edit-input"
              value={toLocalInputValue(draft.end_time)}
              onChange={(e) => setDraft({ ...draft, end_time: fromLocalInputValue(e.target.value) })}
            />
          </label>
          <label className="gmail-edit-field">
            <span className="gmail-edit-label">Location</span>
            <input
              className="gmail-edit-input"
              value={draft.location || ''}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="gmail-edit-field gmail-edit-field-body">
            <span className="gmail-edit-label">Description</span>
            <textarea
              className="gmail-edit-textarea"
              value={draft.description || ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              spellCheck={false}
            />
          </label>
          <div className="gmail-editor-actions">
            <button
              type="button"
              className="gmail-send-btn"
              onClick={handleSave}
              disabled={!canSave || saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="live-preview-shell" style={{ marginTop: 10 }}>
          {doc.previewUrl ? (
            <iframe
              className="live-preview-frame live-preview-frame-calendar"
              src={doc.previewUrl}
              title={'Google Calendar: ' + doc.title}
              referrerPolicy="no-referrer-when-downgrade"
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"
            />
          ) : (
            <div className="live-preview-empty">
              <div className="form-body">
                <div className="form-desc">{draft.details || 'Calendar live preview'}</div>
                <div className="form-q">
                  <div className="form-q-num" style={{ color: APPS.calendar.accent }}>1.</div>
                  <div className="form-q-body">
                    <div className="form-q-text">{draft.summary}</div>
                    <div className="form-q-type">Open live to view event details in Google Calendar.</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SitesApp({ doc, setDoc }: { doc: DocState; setDoc: (d: DocState) => void }) {
  const content = doc.content as SitesContent;
  return (
    <div className="app-surface">
      <div className="app-titlebar" style={{ borderColor: APPS.sites.accent }}>
        <AppTitleEdit value={content.title} accent={APPS.sites.accent}
          onChange={(v) => setDoc({ ...doc, content: { ...content, title: v } })} />
        <span className="app-saved">published</span>
      </div>
      <div className="site-body">
        {content.blocks.map((b, i) => {
          if (b.kind === 'hero') return (
            <div className="site-hero" key={i} style={{ borderColor: APPS.sites.accent }}>
              <div className="site-hero-title" style={{ color: APPS.sites.accent }}>{b.title}</div>
              <div className="site-hero-body">{b.body}</div>
            </div>
          );
          if (b.kind === 'grid') return (
            <div className="site-grid" key={i}>
              {(b.items || []).map((it, j) => (
                <div className="site-card" key={j}>
                  <span className="site-card-dot" style={{ background: APPS.sites.accent }} />{it}
                </div>
              ))}
            </div>
          );
          return (
            <div className="site-text" key={i}>
              <div className="site-text-h" style={{ color: APPS.sites.accent }}>{b.title}</div>
              <div>{b.body}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClassroomApp({ doc, setDoc }: { doc: DocState; setDoc: (d: DocState) => void }) {
  const content = doc.content as ClassroomContent;
  return (
    <div className="app-surface">
      <div className="app-titlebar" style={{ borderColor: APPS.classroom.accent }}>
        <AppTitleEdit value={content.title} accent={APPS.classroom.accent}
          onChange={(v) => setDoc({ ...doc, content: { ...content, title: v } })} />
        <span className="app-saved">{content.students} students</span>
      </div>
      <div className="class-body">
        <div className="class-banner" style={{ background: `linear-gradient(135deg,${APPS.classroom.accent} 0%, #155d3a 100%)` }}>
          <div className="class-banner-title">{content.title}</div>
          <div className="class-banner-sub">{content.section}</div>
        </div>
        <div className="class-section-title">assignments</div>
        {content.assignments.map((a, i) => (
          <div className="class-row" key={i}>
            <span className="class-dot" style={{ background: APPS.classroom.accent }} />
            <div className="class-row-body">
              <div className="class-row-title">{a.title}</div>
              <div className="class-row-sub">due {a.due} · {a.points} pts</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriveApp({ doc }: { doc: DocState }) {
  const content = doc.content as DriveContent;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedKey(content.items.length ? driveItemKey(content.items[0]) : null);
  }, [doc.title, content.items]);

  const selectedItem = content.items.find((item) => driveItemKey(item) === selectedKey) || content.items[0] || null;
  const previewUrl = selectedItem ? driveItemPreviewUrl(selectedItem) : undefined;
  const openUrl = selectedItem ? driveItemOpenUrl(selectedItem) : undefined;

  return (
    <div className="app-surface">
      <div className="app-titlebar">
        <span className="app-title-read drive-title">
          <span style={{ color: DRIVE_MIX[0] }}>d</span>
          <span style={{ color: DRIVE_MIX[1] }}>r</span>
          <span style={{ color: DRIVE_MIX[2] }}>i</span>
          <span style={{ color: DRIVE_MIX[3] }}>v</span>
          <span style={{ color: DRIVE_MIX[0] }}>e</span>
        </span>
        <span className="app-saved">{content.items.length} files</span>
      </div>
      <div className="drive-workspace">
        <div className="drive-grid drive-list">
          {content.items.map((it, i) => {
            const color = it.kind === 'drive' ? DRIVE_MIX[i % DRIVE_MIX.length] : (APPS[it.kind as AppKey]?.accent || '#888');
            const itemKey = driveItemKey(it);
            const isSelected = selectedKey === itemKey;
            return (
              <button
                type="button"
                key={itemKey}
                className={'drive-tile drive-tile-button' + (isSelected ? ' is-selected' : '')}
                onClick={() => setSelectedKey(itemKey)}
              >
                <div className="drive-thumb" style={{ borderColor: color }}>
                  <span className="drive-kind" style={{ color }}>{APPS[it.kind as AppKey]?.ext || 'file'}</span>
                </div>
                <div className="drive-name">{it.name}</div>
                <div className="drive-time">{it.modified}</div>
              </button>
            );
          })}
        </div>
        <div className="drive-preview">
          <div className="drive-preview-head">
            <div className="drive-preview-title">{selectedItem ? selectedItem.name : 'Select a file'}</div>
            <div className="drive-preview-meta">{selectedItem?.mimeType || (selectedItem ? selectedItem.kind : 'drive preview')}</div>
            {openUrl ? (
              <a className="app-live-link drive-open-link" href={openUrl} target="_blank" rel="noreferrer">open live</a>
            ) : null}
          </div>
          <div className="drive-preview-shell">
            {previewUrl ? (
              <iframe
                className="drive-preview-frame"
                src={previewUrl}
                title={selectedItem ? 'Drive file: ' + selectedItem.name : 'Drive preview'}
                referrerPolicy="no-referrer-when-downgrade"
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"
              />
            ) : (
              <div className="drive-preview-empty">
                <div className="form-body">
                  <div className="form-desc">
                    {selectedItem ? 'This file does not expose an embeddable preview.' : 'Select a file in Drive to preview it here.'}
                  </div>
                  {selectedItem && (
                    <div className="form-q">
                      <div className="form-q-num" style={{ color: DRIVE_MIX[0] }}>1.</div>
                      <div className="form-q-body">
                        <div className="form-q-text">{selectedItem.name}</div>
                        <div className="form-q-type">Open live to view this file in Google Drive.</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Terminal components ───────────────────────────────────────────────────
function LoadingDots({ accent }: { accent: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 260);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="loading">
      <span style={{ color: accent }}>thinking</span>
      <span className="loading-dots">{'.'.repeat(step)}</span>
    </div>
  );
}

function HelpBlock({ accent }: { accent: string }) {
  const samples: [string, string][] = [
    ['create a doc for q2 planning', 'open docs'],
    ['create a sheet for hiring', 'open sheets'],
    ['create slides for board review', 'open slides'],
    ['draft email to sam@acme.co', 'open gmail'],
    ['create a form for feedback', 'open forms'],
    ['create a class for cs101', 'open classroom'],
    ['create a site for our team', 'open sites'],
    ['open drive', 'show all files'],
    ['rename to <title>', 'edit open app'],
    ['add section <name>', 'docs only'],
    ['add row a, b, c, d', 'sheets only'],
    ['exit  /  close', 'close sidebar'],
    ['clear', 'clear terminal'],
  ];
  return (
    <div className="help-block">
      {samples.map(([cmd, note], i) => (
        <div className="help-row" key={i}>
          <span className="help-cmd" style={{ color: accent }}>{cmd}</span>
          <span className="help-note">{note}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleAck({ msg, accent }: { msg: string; accent: string }) {
  return (
    <div className="ack">
      <span className="ack-check" style={{ color: accent }}>✓</span>
      <span className="ack-msg">{msg}</span>
    </div>
  );
}

function ErrorAck({ msg }: { msg: string }) {
  return (
    <div className="ack err">
      <span className="ack-check">✗</span>
      <span className="ack-msg">{msg}</span>
    </div>
  );
}

function CommandBlockView({ block, accent }: { block: Block; accent: string }) {
  return (
    <div className="block">
      <div className="block-input">
        <Prompt openDoc={block.ctxDoc} accent={block.promptAccent} />
        <span className="block-input-text">{block.input}</span>
      </div>
      {block.status === 'loading' && <LoadingDots accent={accent} />}
      {block.status === 'success' && block.kind === 'help' && <HelpBlock accent={accent} />}
      {block.status === 'success' && block.kind === 'ack' && <SimpleAck msg={block.msg!} accent={block.ackAccent || accent} />}
      {block.status === 'error' && <ErrorAck msg={block.error!} />}
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (s: string) => void }) {
  const samples = ['create a doc for q2 planning', 'create a sheet for hiring tracker', 'create slides for board review', 'open drive'];
  return (
    <div className="suggestions">
      <div className="sugg-label">try</div>
      <div className="sugg-chips">
        {samples.map((s, i) => (<button key={i} onClick={() => onPick(s)} className="sugg-chip">{s}</button>))}
      </div>
    </div>
  );
}

function WindowChrome({ children, showChrome, openDoc }: { children: React.ReactNode; showChrome: boolean; openDoc: DocState | null }) {
  const rightLabel = openDoc ? APPS[openDoc.app].label + ' · ' + openDoc.title.toLowerCase() : 'google workspace terminal';
  if (!showChrome) return <div className="chrome-naked">{children}</div>;
  return (
    <div className="chrome">
      <div className="chrome-bar">
        <div className="chrome-lights">
          <span className="light l-red" />
          <span className="light l-yellow" />
          <span className="light l-green" />
        </div>
        <div className="chrome-title">shine</div>
        <div className="chrome-right">{rightLabel}</div>
      </div>
      <div className="chrome-body">{children}</div>
    </div>
  );
}

function TweaksPanel({ tweaks, setTweaks, visible, onClose }: { tweaks: Tweaks; setTweaks: (t: Tweaks) => void; visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <div className="tweaks-title">tweaks</div>
        <button type="button" className="tweaks-close" onClick={onClose} aria-label="Close tweaks panel">×</button>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">density</div>
        <div className="tweaks-opts">
          {(['cozy', 'compact'] as const).map((d) => (
            <button key={d} className={'tweaks-pill ' + (tweaks.density === d ? 'on' : '')} onClick={() => setTweaks({ ...tweaks, density: d })}>{d}</button>
          ))}
        </div>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">chrome</div>
        <div className="tweaks-opts">
          {([['on', true], ['off', false]] as [string, boolean][]).map(([l, v]) => (
            <button key={l} className={'tweaks-pill ' + (tweaks.chrome === v ? 'on' : '')} onClick={() => setTweaks({ ...tweaks, chrome: v })}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
const APP_COMPONENTS: Record<AppKey, React.FC<{ doc: DocState; setDoc: (d: DocState | null) => void }>> = {
  docs: DocsApp, sheets: SheetsApp, slides: SlidesApp, gmail: GmailApp,
  forms: FormsApp, calendar: CalendarApp, sites: SitesApp, classroom: ClassroomApp, drive: DriveApp,
};

export function Terminal({ onLogout }: { onLogout?: () => void } = {}) {
  void onLogout;
  const [tweaks, setTweaks] = useState<Tweaks>({ density: 'cozy', chrome: true, sidebar: 'right', paneWidth: 540 });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showTweaks, setShowTweaks] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocState | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const accent = openDoc ? accentFor(openDoc.app) : DEFAULT_ACCENT;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [blocks, openDoc]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('.app-pane')) return;
      if (target.closest('.tweaks')) return;
      inputRef.current?.focus();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    getAuthStatus()
      .then((ok) => {
        if (!mounted) return;
        setIsAuthenticated(ok);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!mounted) return;
        setIsAuthenticated(false);
        setAuthChecked(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const pushBlock = (b: Block) => setBlocks((prev) => [...prev, b]);
  const updateBlock = (id: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const applyEdit = (op: string, value: string, currentOpen: DocState): [DocState | null, string | null] => {
    const d = { ...currentOpen };
    if (op === 'rename') {
      d.title = titleCase(value); d.slug = slug(value);
      if (d.app === 'forms' || d.app === 'sites' || d.app === 'classroom')
        d.content = { ...(d.content as Record<string, unknown>), title: titleCase(value) };
      return [d, `renamed to "${d.title}"`];
    }
    if (op === 'addSection' && d.app === 'docs') {
      d.content = [...(d.content as DocsContent[]), { h: titleCase(value), p: 'Add your content here.' }];
      return [d, `added section "${titleCase(value)}"`];
    }
    if (op === 'addRow' && d.app === 'sheets') {
      const c = d.content as SheetsContent;
      const cells = value.split(/\s*,\s*/);
      const padded = [...cells];
      while (padded.length < c.headers.length) padded.push('');
      d.content = { ...c, rows: [...c.rows, padded.slice(0, c.headers.length)] };
      return [d, 'added 1 row'];
    }
    if (op === 'addSlide' && d.app === 'slides') {
      d.content = [...(d.content as SlidesContent[]), { title: titleCase(value), sub: 'tap to edit' }];
      return [d, `added slide "${titleCase(value)}"`];
    }
    if (op === 'addQuestion' && d.app === 'forms') {
      const c = d.content as FormsContent;
      d.content = { ...c, questions: [...c.questions, { q: value, type: 'long' as const }] };
      return [d, 'added question'];
    }
    if (op === 'addAssignment' && d.app === 'classroom') {
      const c = d.content as ClassroomContent;
      d.content = { ...c, assignments: [...c.assignments, { title: titleCase(value), due: 'tbd', points: 25 }] };
      return [d, 'added assignment'];
    }
    if (op === 'setTo' && d.app === 'gmail') {
      d.content = { ...(d.content as GmailContent), to: value };
      return [d, `set to ${value}`];
    }
    if (op === 'setSubject' && d.app === 'gmail') {
      d.content = { ...(d.content as GmailContent), subject: value };
      return [d, 'subject set'];
    }
    if (op === 'append') {
      if (d.app === 'docs') {
        const c = d.content as DocsContent[];
        const last = c[c.length - 1];
        d.content = [...c.slice(0, -1), { ...last, p: last.p + ' ' + value }];
        return [d, 'appended text'];
      }
      if (d.app === 'gmail') {
        const c = d.content as GmailContent;
        d.content = { ...c, body: c.body + '\n' + value };
        return [d, 'appended line'];
      }
    }
    return [null, null];
  };

  const runCommand = useCallback(async (rawInput: string) => {
    const cmd = rawInput.trim();
    if (!cmd) return;
    setHistory((h) => [cmd, ...h]);
    setHistoryIdx(-1);
    const currentOpen = openDoc;
    const promptAccent = accentFor(currentOpen?.app);
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pushBlock({ id, input: cmd, status: 'loading', ctxDoc: currentOpen, promptAccent });
    await new Promise((r) => setTimeout(r, 360 + Math.random() * 260));
    if (/^(login|signin|sign-in|auth)$/i.test(cmd)) {
      updateBlock(id, { status: 'success', kind: 'ack', msg: 'opening google login...', ackAccent: '#34A853' });
      window.location.href = getGoogleAuthUrl();
      return;
    }

    if (/^(status|auth status)$/i.test(cmd)) {
      const ok = await getAuthStatus();
      setIsAuthenticated(ok);
      updateBlock(id, {
        status: 'success',
        kind: 'ack',
        msg: ok ? 'authenticated with google' : 'not authenticated. run: login',
        ackAccent: ok ? '#34A853' : '#EA4335',
      });
      return;
    }

    const parsed = parseLocalCommand(cmd, currentOpen?.app);
    if (parsed?.type === 'clear') { setBlocks([]); return; }
    if (parsed?.type === 'help') { updateBlock(id, { status: 'success', kind: 'help' }); return; }
    if (parsed?.type === 'close') {
      if (!currentOpen) { updateBlock(id, { status: 'error', error: 'nothing to close' }); return; }
      setOpenDoc(null);
      updateBlock(id, { status: 'success', kind: 'ack', msg: `closed ${currentOpen.title.toLowerCase()}`, ackAccent: promptAccent });
      return;
    }
    if (parsed?.type === 'open') {
      if (!currentOpen) { updateBlock(id, { status: 'error', error: 'nothing open — create something first' }); return; }
      const targetUrl = currentOpen.url;
      if (!targetUrl) {
        updateBlock(id, { status: 'error', error: `no live url available for ${currentOpen.title.toLowerCase()}` });
        return;
      }
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      updateBlock(id, { status: 'success', kind: 'ack', msg: `opened ${currentOpen.title.toLowerCase()} in ${APPS[currentOpen.app].label}.google.com`, ackAccent: promptAccent });
      return;
    }
    if (parsed?.type === 'ls') {
      updateBlock(id, { status: 'success', kind: 'ack', msg: currentOpen ? currentOpen.title + '.' + APPS[currentOpen.app].ext : 'no open files', ackAccent: promptAccent });
      return;
    }
    if (parsed?.type === 'edit') {
      if (!currentOpen) { updateBlock(id, { status: 'error', error: 'no open app to edit' }); return; }
      const [newDoc, msg] = applyEdit(parsed.op, parsed.value, currentOpen);
      if (newDoc && msg) { setOpenDoc(newDoc); updateBlock(id, { status: 'success', kind: 'ack', msg, ackAccent: promptAccent }); }
      else updateBlock(id, { status: 'error', error: `can't do "${parsed.op}" in ${currentOpen.app}` });
      return;
    }

    if (!authChecked || !isAuthenticated) {
      updateBlock(id, { status: 'error', error: 'not authenticated. run: login' });
      return;
    }

    try {
      // Always send full workspace state so the backend can clear stale session data
      const hints = {
        activeDocumentId: currentOpen?.app === 'docs' && currentOpen.url
          ? (extractGoogleWorkspaceFileIdFromUrl(currentOpen.url) ?? '') : '',
        activeDocumentTitle: currentOpen?.app === 'docs' ? currentOpen.title : '',
        activeSpreadsheetId: currentOpen?.app === 'sheets' && currentOpen.url
          ? (extractGoogleWorkspaceFileIdFromUrl(currentOpen.url) ?? '') : '',
        activeSpreadsheetTitle: currentOpen?.app === 'sheets' ? currentOpen.title : '',
        activePresentationId: currentOpen?.app === 'slides' && currentOpen.url
          ? (extractGoogleWorkspaceFileIdFromUrl(currentOpen.url) ?? '') : '',
        activePresentationTitle: currentOpen?.app === 'slides' ? currentOpen.title : '',
        activeFormId: currentOpen?.app === 'forms' && currentOpen.url
          ? (extractGoogleWorkspaceFileIdFromUrl(currentOpen.url) ?? '') : '',
        activeFormTitle: currentOpen?.app === 'forms' ? currentOpen.title : '',
      };
      const result = await parseWorkspaceCommand(cmd, hints);
      const nextDoc = docFromWorkspaceResult(result, cmd);
      if (nextDoc) setOpenDoc(nextDoc);
      const ackAccent = nextDoc ? accentFor(nextDoc.app) : '#34A853';
      updateBlock(id, {
        status: 'success',
        kind: 'ack',
        msg: result?.summary || `completed ${result?.action || 'request'}`,
        ackAccent,
      });
    } catch (error: any) {
      const msg = String(error?.message || 'request failed');
      if (/401|unauthorized|not authenticated/i.test(msg)) {
        setIsAuthenticated(false);
        updateBlock(id, { status: 'error', error: 'session expired. run: login' });
        return;
      }
      updateBlock(id, { status: 'error', error: msg });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDoc, authChecked, isAuthenticated]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { runCommand(input); setInput(''); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next); setInput(history[next] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next); setInput(next === -1 ? '' : history[next]);
    }
  };

  const AppComp = openDoc ? APP_COMPONENTS[openDoc.app] : null;
  const multi = isMultiApp(openDoc?.app);
  const layoutCls = ['layout', openDoc ? 'has-app' : '', 'sidebar-' + tweaks.sidebar].filter(Boolean).join(' ');
  const layoutStyle = tweaks.sidebar === 'right' ? ({ ['--pane-width' as any]: `${tweaks.paneWidth}px` }) : undefined;

  const startPaneResize = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tweaks.sidebar !== 'right' || !openDoc) return;
    e.preventDefault();
    resizingRef.current = true;
    document.body.classList.add('pane-resizing');

    const onMouseMove = (event: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = window.innerWidth - event.clientX;
      const clamped = Math.max(360, Math.min(860, next));
      setTweaks((prev) => ({ ...prev, paneWidth: clamped }));
    };

    const stopResize = () => {
      resizingRef.current = false;
      document.body.classList.remove('pane-resizing');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
  };

  return (
    <WindowChrome showChrome={tweaks.chrome} openDoc={openDoc}>
      <div className={layoutCls} style={layoutStyle}>
        <div className={'terminal-pane density-' + tweaks.density} ref={scrollRef}>
          {blocks.length === 0 && !openDoc && (
            <div className="welcome">
              <h1 className="welcome-title" style={{ color: accent }}>welcome to shine</h1>
              <p className="welcome-sub">control your entire google workspace using natural language commands</p>
              {authChecked && !isAuthenticated && (
                <div className="ack err" style={{ marginTop: 10 }}>
                  <span className="ack-check">!</span>
                  <span className="ack-msg">google not connected. type "login" to authenticate.</span>
                </div>
              )}
            </div>
          )}
          {blocks.map((b) => (<CommandBlockView key={b.id} block={b} accent={accent} />))}
          <div className="active-line">
            <Prompt openDoc={openDoc} accent={accent} />
            <input
              ref={inputRef}
              className={'active-input' + (multi ? ' drive-caret' : '')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={openDoc ? `edit "${openDoc.title.toLowerCase()}"... (e.g., add section risks)` : 'type a command... (e.g., create a doc for q2 planning)'}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
          </div>
          {blocks.length === 0 && !openDoc && (
            <Suggestions onPick={(s) => { setInput(s); runCommand(s); }} />
          )}
        </div>
        {openDoc && AppComp && (
          <div className="pane-resizer" onMouseDown={startPaneResize} role="separator" aria-orientation="vertical" />
        )}
        {openDoc && AppComp && (
          <div className="app-pane" onClick={(e) => e.stopPropagation()}>
            <div className="app-pane-header">
              <div className="app-breadcrumb">
                <span className="app-bread-dot" style={{ background: accentFor(openDoc.app) }} />
                <span className="app-bread-text">
                  <span className="app-bread-dim">~/{APPS[openDoc.app].path}/</span>
                  <span className="app-bread-file">{openDoc.slug}.{APPS[openDoc.app].ext}</span>
                </span>
              </div>
              <button className="app-close" onClick={() => setOpenDoc(null)} title="close">×</button>
            </div>
            <div className="app-pane-scroll">
              <AppComp doc={openDoc} setDoc={setOpenDoc} />
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => setShowTweaks(v => !v)}
        className="tweaks-toggle"
      >
        tweaks
      </button>
      <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} visible={showTweaks} onClose={() => setShowTweaks(false)} />
    </WindowChrome>
  );
}
