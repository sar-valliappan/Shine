import 'dotenv/config';
import { parseCommand } from './services/gemini';
import { generateDocumentContent, generateEmailBody } from './prompts/contentGenerator';

const COMMANDS = [
  'create a Q2 budget spreadsheet',
  'write a project proposal for an AI productivity app',
  'draft an email to john@example.com about the meeting tomorrow',
  'list my recent files',
  'find my marketing presentation',
  'make slides',  // ambiguous — should trigger clarify
];

async function run() {
  console.log('=== GEMINI PARSE TESTS ===\n');

  for (const cmd of COMMANDS) {
    console.log(`INPUT: "${cmd}"`);
    try {
      const action = await parseCommand(cmd);
      console.log('ACTION:', JSON.stringify(action, null, 2));
    } catch (e: any) {
      console.log('ERROR:', e.message);
    }
    console.log('---');
  }

  console.log('\n=== CONTENT GENERATION TESTS ===\n');

  console.log('Generating document content...');
  const docContent = await generateDocumentContent(
    'Q2 Marketing Strategy',
    'Write a comprehensive marketing strategy for Q2 covering digital campaigns, budget allocation, and KPIs',
    ['Executive Summary', 'Campaign Overview', 'Budget', 'KPIs'],
  );
  console.log('DOC CONTENT (first 400 chars):\n', docContent.slice(0, 400), '\n---');

  console.log('Generating email body...');
  const emailBody = await generateEmailBody(
    'Follow-up on Project Proposal',
    'Friendly follow-up asking for feedback on the proposal sent last week, mention the deadline is Friday',
  );
  console.log('EMAIL BODY:\n', emailBody, '\n---');
}

run().catch(console.error);
