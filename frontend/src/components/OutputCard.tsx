import type { WorkspaceResult } from '../hooks/useTerminal';
import { 
  FileText, 
  Table, 
  HardDrive, 
  Mail, 
  Presentation, 
  Calendar as CalendarIcon,
  CheckSquare,
  Info
} from 'lucide-react';

interface Props {
  result: WorkspaceResult;
}

const iconMap = {
  doc: <FileText className="w-5 h-5 text-blue-400" />,
  sheet: <Table className="w-5 h-5 text-green-400" />,
  drive: <HardDrive className="w-5 h-5 text-yellow-400" />,
  gmail: <Mail className="w-5 h-5 text-red-400" />,
  slides: <Presentation className="w-5 h-5 text-orange-400" />,
  calendar: <CalendarIcon className="w-5 h-5 text-indigo-400" />,
  form: <CheckSquare className="w-5 h-5 text-purple-400" />,
  list: <HardDrive className="w-5 h-5 text-yellow-400" />,
  system: <Info className="w-5 h-5 text-gray-300" />
};

export function OutputCard({ result }: Props) {
  const Icon = iconMap[result.fileType] || iconMap.doc;

  if (result.fileType === 'list' && result.items) {
    return (
      <div className="bg-[#1c2128] rounded-md p-3 border border-[#30363d] shadow-inner mt-2">
        <div className="flex items-center gap-2 mb-2 font-bold text-terminal-accent">
          {Icon}
          <span>{result.summary || 'QUERY RESULTS'}</span>
        </div>
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {result.items.map((item, idx) => (
            <a 
              key={idx} 
              href={item.webViewLink || item.url} 
              target="_blank" 
              rel="noreferrer"
              className="hover:bg-[#30363d] p-1 rounded text-terminal-cyan flex items-center justify-between"
            >
              <span className="truncate">{item.name || item.title}</span>
              <span className="text-xs text-gray-500">{item.modifiedTime || item.date}</span>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1c2128] rounded-md p-4 border border-[#30363d] shadow-inner mt-2 flex items-start gap-4 hover:border-terminal-cyan transition-colors group">
      <div className="bg-[#0d1117] p-3 rounded-lg border border-[#30363d] group-hover:border-terminal-cyan transition-colors">
        {Icon}
      </div>
      <div className="flex flex-col flex-1">
        <div className="text-terminal-accent font-bold mb-1 flex items-center gap-2">
          <span>✓</span>
          <span>{result.summary || `Created: ${result.title}`}</span>
        </div>
        
        {result.url ? (
          <a 
            href={result.url} 
            target="_blank" 
            rel="noreferrer"
            className="text-terminal-cyan hover:underline font-mono text-sm break-all"
          >
            {result.url}
          </a>
        ) : (
          <span className="text-gray-400 text-sm">No URL provided</span>
        )}
      </div>
    </div>
  );
}
