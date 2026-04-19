export interface ActiveFile {
  id: string;
  type: 'presentation' | 'document' | 'spreadsheet';
  title: string;
}

interface SessionContext {
  activeFile: ActiveFile | null;
  history: string[];
}

const store = new Map<string, SessionContext>();

function getCtx(sessionId: string): SessionContext {
  if (!store.has(sessionId)) {
    store.set(sessionId, { activeFile: null, history: [] });
  }
  return store.get(sessionId)!;
}

export function getActiveFile(sessionId: string): ActiveFile | null {
  return getCtx(sessionId).activeFile;
}

export function setActiveFile(sessionId: string, file: ActiveFile): void {
  getCtx(sessionId).activeFile = file;
}

export function addToHistory(sessionId: string, entry: string): void {
  const ctx = getCtx(sessionId);
  ctx.history.push(entry);
  if (ctx.history.length > 10) ctx.history.shift();
}

export function getHistory(sessionId: string): string[] {
  return [...getCtx(sessionId).history];
}
