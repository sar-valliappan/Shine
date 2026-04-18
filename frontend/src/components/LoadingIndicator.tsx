import { useState, useEffect } from 'react';

export function LoadingIndicator() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-terminal-accent font-mono animate-pulse">
      <span className="opacity-80">PROCESSING REQUEST</span>
      <span className="w-8">{dots}</span>
    </div>
  );
}
