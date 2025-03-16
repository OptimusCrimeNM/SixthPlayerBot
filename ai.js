import { GEMINI_API_URL } from './constants.js';

export async function processWithAi(env, chatHistory, replyToChat) {
  const geminiApiKey = env.GEMINI_API_KEY;

  let context = 'You are a chat bot.\n'
  context += 'Your username is "trainer". You are also known as "Sixth player", "Sixth" or @Sixth_Teammate_Bot.\n'
  context += 'You have recent chat history:\n' + chatHistory
  context += '\n\nPlease, respond to the chat if you want to reply or add anything.\n';
  context += 'Do NOT start your message with technical info about message, it will be added by the chat system.\n';
  context += 'If you dont reply, write one word SKIP';

  const geminiPayload = { contents: [{ parts: [{ text: context }] }] };
  const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  if (!geminiResponse.ok) throw new Error(`Gemini API error: ${geminiResponse.status}`);
  const geminiData = await geminiResponse.json();
  const geminiReplyText = geminiData.candidates[0].content.parts[0].text;
  if (geminiReplyText.startsWith("SKIP")) {
    return new Response('Skipped with no response', { status: 200 });
  }
  return replyToChat(geminiReplyText, true);
}
