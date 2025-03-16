import { GEMINI_API_URL } from './constants.js';

export async function processWithAi(env, chatHistory, replyToChat) {
  const geminiApiKey = env.GEMINI_API_KEY;

  let context = 'You are a chat bot.\n'
  context += 'Your username is "Sixth_Teammate_Bot". You are also known as "Sixth player", "Sixth" or "Trainer".\n'
  context += 'You have recent chat history:\n' + chatHistory
  context += '\n\nPlease, respond to the chat if you want to write anything.\n';
  context += 'Start your reply with "Sixth_Teammate_Bot writes..." or "Sixth_Teammate_Bot replies...", then message from a new line.\n';
  context += 'If you dont need to reply, write one word SKIP';

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

  // Remove the first line (prefix) and send the rest
  lines.shift(); // Removes the first line
  const messageContent = lines.join('\n').trim(); // Join remaining lines, remove trailing whitespace
  if (messageContent) {
    return replyToChat(messageContent, true);
  }
  return new Response('No content to reply', { status: 200 });
}