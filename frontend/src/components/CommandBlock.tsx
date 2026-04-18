import type { CommandBlock as CommandBlockType } from '../hooks/useTerminal';
import { LoadingIndicator } from './LoadingIndicator';
import { OutputCard } from './OutputCard';

interface Props {
  block: CommandBlockType;
}

export function CommandBlock({ block }: Props) {
  return (
    <div className="flex flex-col space-y-2 mb-4 bg-terminal-card border border-terminal-border rounded-lg p-4 shadow-lg backdrop-blur-sm bg-opacity-80">
      {/* Input Line */}
      <div className="flex items-center gap-3 text-lg font-mono">
        <span className="text-terminal-cyan font-bold opacity-70">&gt;</span>
        <span className="text-terminal-text">{block.input}</span>
      </div>

      {/* Output Area */}
      <div className="mt-2 text-sm">
        {block.status === 'loading' && <LoadingIndicator />}
        {block.status === 'success' && block.output && <OutputCard result={block.output} />}
        {block.status === 'error' && (
          <div className="text-terminal-error font-mono">
            ERROR: {block.error}
          </div>
        )}
      </div>
    </div>
  );
}
