import { useState } from 'react';

// Make sure these types align with our WorkspaceResult
export interface WorkspaceResult {
  action: string;
  title?: string;
  url?: string;
  embedUrl?: string;
  eventId?: string;
  calendarId?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  summary?: string;
  fileType: 'doc' | 'sheet' | 'drive' | 'slides' | 'calendar' | 'form' | 'gmail' | 'list' | 'system';
  items?: any[];
}

export interface CommandBlock {
  id: string;
  input: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  output?: WorkspaceResult;
  error?: string;
  timestamp: number;
}

export function useTerminal() {
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);

  const addBlock = (input: string): string => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    setBlocks((prev) => [
      ...prev,
      {
        id,
        input,
        status: 'loading',
        timestamp: Date.now(),
      },
    ]);
    return id;
  };

  const updateBlockSuccess = (id: string, output: WorkspaceResult) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, status: 'success', output } : block))
    );
  };

  const updateBlockError = (id: string, error: string) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, status: 'error', error } : block))
    );
  };

  return { blocks, addBlock, updateBlockSuccess, updateBlockError };
}
