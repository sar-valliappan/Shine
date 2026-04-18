import { GoogleGenerativeAI, FunctionCallingMode, SchemaType } from '@google/generative-ai';
import type { FunctionDeclaration } from '@google/generative-ai';
import { commandParserSystemPrompt } from '../prompts/commandParser';
import type { WorkspaceAction } from '../types/actions';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const workspaceFunctions: FunctionDeclaration[] = [
  {
    name: 'create_document',
    description: 'Creates a new Google Doc with AI-generated content',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING, description: 'Title of the document' },
        content_prompt: { type: SchemaType.STRING, description: 'Detailed prompt for generating the document body' },
        sections: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'List of section headings' },
      },
      required: ['title', 'content_prompt'],
    },
  },
  {
    name: 'create_spreadsheet',
    description: 'Creates a new Google Sheet with structured data and optional formulas',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        headers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Column header names' },
        rows: { type: SchemaType.ARRAY, items: { type: SchemaType.ARRAY }, description: 'Array of data rows' },
        include_formulas: { type: SchemaType.BOOLEAN, description: 'Whether to append SUM/formula rows' },
      },
      required: ['title', 'headers', 'rows'],
    },
  },
  {
    name: 'create_presentation',
    description: 'Creates a Google Slides presentation with AI-generated slide outlines',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        slide_prompts: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Description of what each slide should contain',
        },
      },
      required: ['title', 'slide_prompts'],
    },
  },
  {
    name: 'create_event',
    description: 'Schedules a new event on Google Calendar',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        summary: { type: SchemaType.STRING, description: 'Event title' },
        start_time: { type: SchemaType.STRING, description: 'ISO 8601 date-time string' },
        end_time: { type: SchemaType.STRING, description: 'ISO 8601 date-time string' },
        location: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
      },
      required: ['summary', 'start_time', 'end_time'],
    },
  },
  {
    name: 'create_form',
    description: 'Creates a Google Form for surveys or data collection',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        questions: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              type: { type: SchemaType.STRING, enum: ['TEXT', 'MULTIPLE_CHOICE'] },
            },
          },
          description: 'List of form questions',
        },
      },
      required: ['title', 'questions'],
    },
  },
  {
    name: 'create_draft',
    description: 'Creates a Gmail draft with AI-generated body',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        to: { type: SchemaType.STRING, description: 'Recipient email address' },
        subject: { type: SchemaType.STRING },
        body_prompt: { type: SchemaType.STRING, description: 'Prompt describing what the email should say' },
      },
      required: ['to', 'subject', 'body_prompt'],
    },
  },
  {
    name: 'send_email',
    description: 'Sends an email immediately via Gmail',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        to: { type: SchemaType.STRING },
        subject: { type: SchemaType.STRING },
        body_prompt: { type: SchemaType.STRING },
      },
      required: ['to', 'subject', 'body_prompt'],
    },
  },
  {
    name: 'list_files',
    description: 'Lists recent files from Google Drive',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Optional MIME type or keyword filter' },
        limit: { type: SchemaType.NUMBER, description: 'Max number of files to return' },
      },
      required: ['limit'],
    },
  },
  {
    name: 'search_drive',
    description: 'Searches Google Drive for files matching a query',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING },
      },
      required: ['query'],
    },
  },
  {
    name: 'clarify',
    description: 'Ask the user for clarification when the command is ambiguous or incomplete',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        question: { type: SchemaType.STRING },
      },
      required: ['question'],
    },
  },
];

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  systemInstruction: commandParserSystemPrompt,
  tools: [{ functionDeclarations: workspaceFunctions }],
  toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.ANY } },
});

export async function parseCommand(command: string): Promise<WorkspaceAction> {
  const result = await model.generateContent(command);
  const calls = result.response.functionCalls();

  if (!calls || calls.length === 0) {
    throw new Error(`Gemini did not return a function call for: "${command}"`);
  }

  const { name, args } = calls[0];
  return { action: name, ...args } as WorkspaceAction;
}
