import type { WorkspaceResult } from '../hooks/useTerminal';

export const mockParseCommand = async (input: string): Promise<WorkspaceResult> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const lower = input.toLowerCase();
      
      if (lower.includes('error')) {
        reject(new Error('Simulated network error or API failure.'));
        return;
      }

      if (lower.includes('sheet') || lower.includes('budget')) {
        resolve({
          action: 'create_spreadsheet',
          title: 'Q2 Budget',
          fileType: 'sheet',
          url: 'https://docs.google.com/spreadsheets/d/mock-id',
          summary: 'Created: Q2 Budget Spreadsheet'
        });
      } else if (lower.includes('mail') || lower.includes('email')) {
        resolve({
          action: 'send_email',
          title: 'Status Update',
          fileType: 'gmail',
          url: 'https://mail.google.com/',
          summary: 'Email Draft Created: Status Update'
        });
      } else if (lower.includes('slide') || lower.includes('presentation')) {
        resolve({
          action: 'create_presentation',
          title: 'Pitch Deck',
          fileType: 'slides',
          url: 'https://docs.google.com/presentation/d/mock-id',
          summary: 'Created: Pitch Deck Presentation'
        });
      } else {
        // default to doc
        resolve({
          action: 'create_document',
          title: 'Mission Briefing',
          fileType: 'doc',
          url: 'https://docs.google.com/document/d/mock-id',
          summary: 'Created: Mission Briefing Document'
        });
      }
    }, 1500); // simulate 1.5s delay
  });
};
