import {GEMINI_API_URL, TELEGRAM_API_BASE_URL} from './constants.js';
import {addMemoryEntries, getChatHistory, getChatMemory, removeMemoryEntries} from "./storage";

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

export async function processWithAi(env, chatId, replyToChat) {
    const geminiApiKey = env.GEMINI_API_KEY;

    const chatHistory = await getChatHistory(env, String(chatId));
    const rememberedContext = await getChatMemory(env, String(chatId));
    let context = 'You are a participants in a text chat.\n'
    const usersCount = await getChatMemberCount(env, chatId)
    if (usersCount) context += `There's ${usersCount} users in the chat.\n`
    if (env.BOT_USERNAME) context += `Your username is "${env.BOT_USERNAME}".\n`
    context += `You are also known as "Sixth player", "Sixth" or "Sixth_Teammate_Bot".\n`
    if (rememberedContext) context += 'You have notes of important facts you made:\n' + rememberedContext + '\n\n'
    if (chatHistory) context += 'You have recent chat history:\n' + chatHistory + '\n\n'

    const scriptValue = await env.KV.get("AI_REQUEST_SCRIPT");
    if (scriptValue) context += scriptValue

    const geminiPayload = {contents: [{parts: [{text: context}]}]};
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) throw new Error(`Gemini API error: ${geminiResponse.status}`);
    const geminiData = await geminiResponse.json();
    const geminiReplyText = geminiData.candidates[0].content.parts[0].text;
    const lines = geminiReplyText.split('\n');
    if (lines) {
        while (!lines[0].includes('{')) lines.shift();
        while (!lines[lines.length - 1].includes('}')) lines.pop();
    }

    if (lines) {
        try {
            const replyObject = JSON.parse(lines.join('\n').trim())
            if (replyObject.remove_note) await removeMemoryEntries(env, chatId, replyObject.remove_note);
            if (replyObject.add_note) await addMemoryEntries(env, chatId, replyObject.add_note);
            if (replyObject.message) return replyToChat(replyObject.message, true);
        } catch (error) {
            console.error(`Wrong ai reply format: ${error.message}`);
            return new Response('Wrong ai reply format', {status: 200});
        }
    }
    return new Response('No content to reply', {status: 200});
}

