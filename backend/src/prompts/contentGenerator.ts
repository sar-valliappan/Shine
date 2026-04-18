import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function generateDocumentContent(
  title: string,
  contentPrompt: string,
  sections: string[],
): Promise<string> {
  const sectionsText =
    sections.length > 0 ? `\n\nUse these section headings: ${sections.join(', ')}` : '';

  const prompt = `Write the full content for a Google Document titled "${title}".${sectionsText}

Instructions: ${contentPrompt}

Format with clear headings and well-structured paragraphs. Be thorough and professional. Output plain text only.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generateEmailBody(subject: string, bodyPrompt: string): Promise<string> {
  const prompt = `Write a professional email body for the subject: "${subject}"

Instructions: ${bodyPrompt}

Output only the email body starting with a salutation. Do not include the subject line or any headers.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
