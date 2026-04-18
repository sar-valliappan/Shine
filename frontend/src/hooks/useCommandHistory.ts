import { useState } from 'react';

export function useCommandHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const push = (cmd: string) => {
    if (!cmd.trim()) return;
    setHistory((prev) => [cmd, ...prev]);
    setHistoryIndex(-1);
  };

  const navigate = (direction: 'up' | 'down'): string | null => {
    if (history.length === 0) return null;

    if (direction === 'up') {
      const newIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(newIndex);
      return history[newIndex];
    } else {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      if (newIndex === -1) {
        return ''; // back to empty input
      }
      return history[newIndex];
    }
  };

  return { push, navigate };
}
