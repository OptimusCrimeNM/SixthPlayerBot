import { GEMINI_API_URL } from './constants.js';

export async function processWithAi(env, chatHistory, replyToChat) {
  const geminiApiKey = env.GEMINI_API_KEY;

  let context = 'You are a chat bot.\n'
  context += 'Your username is "trainer". You are also known as "Sixth player", "Sixth" or "Sixth_Teammate_Bot".\n'
  context += 'You have recent chat history:\n' + chatHistory
  context += '\n\nPlease, respond to the chat if you were requested directly or you want to write anything.\n';
  context += 'Start your message with "trainer writes" or "trainer replies", then text from a new line.\n';
  context += 'If you dont need to respond, write one word SKIP';

  const geminiPayload = { contents: [{ parts: [{ text: context }] }] };
  const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  if (!geminiResponse.ok) throw new Error(`Gemini API error: ${geminiResponse.status}`);
  const geminiData = await geminiResponse.json();
  const geminiReplyText = geminiData.candidates[0].content.parts[0].text;
  const lines = geminiReplyText.split('\n');

  if (lines.length === 0 || lines[0].includes("SKIP")) {
    return new Response('Skipped with no response', { status: 200 });
  }

  if (lines.length > 1) {
    lines.shift(); // Removes the first line
  }
  const messageContent = lines.join('\n').trim(); // Join remaining lines, remove trailing whitespace
  if (messageContent) {
    return replyToChat(messageContent, true);
  }
  return new Response('No content to reply', { status: 200 });
}