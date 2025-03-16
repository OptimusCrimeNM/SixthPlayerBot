import {GEMINI_API_URL, TELEGRAM_API_BASE_URL} from './constants.js';

export async function getChatMemberCount(env, chatId) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/getChatMemberCount?chat_id=${chatId}`;

  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    return undefined;
  }

  const data = await response.json();
  return data.result; // Returns the integer count
}

export async function processWithAi(env, chatHistory, chatId, replyToChat) {
  const geminiApiKey = env.GEMINI_API_KEY;

  let context = 'You are a participants in a text chat.\n'
  const usersCount = await getChatMemberCount(env, chatId)
  if (usersCount) context += `There's ${usersCount} users in the chat.\n`
  if (env.BOT_USERNAME) context += `Your username is "${env.BOT_USERNAME}".\n`
  context += `You are also known as "Sixth player", "Sixth" or "Sixth_Teammate_Bot".\n`
  context += 'You have recent chat history:\n' + chatHistory + '\n\n'
  const scriptValue = await env.KV.get("AI_REQUEST_SCRIPT");
  if (scriptValue) context += scriptValue

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