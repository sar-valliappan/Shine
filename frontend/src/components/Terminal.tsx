import React, { useState, useRef, useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { CommandBlock } from './CommandBlock';
import { parseCommand } from '../services/api';
import { playAudioReadback } from '../services/elevenlabs';

export function Terminal() {
  const [inputValue, setInputValue] = useState('');
  const { blocks, addBlock, updateBlockSuccess, updateBlockError } = useTerminal();
  const { push, navigate } = useCommandHistory();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when blocks change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks]);

  // Focus input when clicking anywhere in the terminal
  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cmd = inputValue.trim();
      if (!cmd) return;
      
      setInputValue('');
      push(cmd);
      
      const blockId = addBlock(cmd);
      
      try {
        const result = await parseCommand(cmd);
        updateBlockSuccess(blockId, result);
        
        if (result.summary) {
          playAudioReadback(result.summary);
        }
      } catch (err: any) {
        updateBlockError(blockId, err.message || 'An unknown error occurred');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = navigate('up');
      if (prev !== null) setInputValue(prev);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = navigate('down');
      if (next !== null) setInputValue(next);
    }
  };

  return (
    <div 
      className="flex flex-col h-full w-full max-w-5xl mx-auto p-6 overflow-y-auto font-mono text-sm"
      onClick={handleTerminalClick}
    >
      <div className="flex-1 pb-4 flex flex-col space-y-4">
        <div className="text-terminal-text opacity-50 mb-6">
          <p>ONYX // TERMINAL v4.2 [SECURE]</p>
          <p>AUTHENTICATED: AGENT 734 [RANK: OPERATIVE]</p>
        </div>
        
        {blocks.map((block) => (
          <CommandBlock key={block.id} block={block} />
        ))}
        
        <div ref={bottomRef} />
      </div>
      
      {/* Active Input Line */}
      <div className="flex items-center gap-3 text-lg mt-4">
        <span className="text-terminal-accent font-bold">AGENT $</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-terminal-text shadow-none focus:ring-0 focus:outline-none"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
