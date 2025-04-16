import {GEMINI_API_URL, TELEGRAM_API_BASE_URL} from './constants.js';
import {addMemoryEntries, getChatHistory, getChatMemory, removeMemoryEntries} from "./storage";
import {finalize} from "./utils";

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

export async function getFileLink(env, fileId) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const url = `${TELEGRAM_API_BASE_URL}${botToken}/getFile?file_id=${fileId}`;

    try {
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
            return undefined;
        }

        const data = await response.json();
        if (!data.result?.file_path) {
            return undefined;
        }

        return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
    } catch (error) {
        console.error(`Error fetching file link for file_id ${fileId}: ${error.message}`);
        return undefined;
    }
}

export async function processPhoto(env, photo) {
    if (!photo || !photo.file_id) return "Couldn't process photo";

    const fileLink = await getFileLink(env, photo.file_id);
    if (!fileLink) return "Couldn't process photo";

    try {
        // Fetch the photo file
        const photoResponse = await fetch(fileLink);
        if (!photoResponse.ok) {
            console.error(`Failed to fetch photo from ${fileLink}: ${photoResponse.status}`);
            return "Couldn't process photo";
        }

        // Convert photo to base64
        const photoBuffer = await photoResponse.arrayBuffer();
        const photoArray = new Uint8Array(photoBuffer);
        const binaryString = Array.from(photoArray)
            .map(byte => String.fromCharCode(byte))
            .join('');
        const photoBase64 = btoa(binaryString);

        // Call Gemini API to describe the photo
        const geminiApiKey = env.GEMINI_API_KEY;
        const geminiPayload = {
            contents: [
                {
                    parts: [
                        { text: "Describe this image. If it's funny, explain concisely the joke." },
                        {
                            inline_data: {
                                mime_type: "image/jpeg", // Adjust if needed (e.g., image/png)
                                data: photoBase64
                            }
                        }
                    ]
                }
            ]
        };

        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        if (!geminiResponse.ok) {
            console.error(`Gemini API error: ${geminiResponse.status}`);
            return "Couldn't describe photo";
        }

        const geminiData = await geminiResponse.json();
        const description = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No description available";

        return description;
    } catch (error) {
        console.error(`Error processing photo: ${error.message}`);
        return "Couldn't process photo";
    }
}

export async function processWithAi(env, chatId, replyToChat) {
    const chatHistory = await getChatHistory(env, String(chatId));
    const rememberedContext = await getChatMemory(env, String(chatId));
    let context = 'You are a participant in a text chat.\n';
    const usersCount = await getChatMemberCount(env, chatId);
    if (usersCount) context += `There're ${usersCount} users in the chat.\n`;
    if (env.BOT_USERNAME) context += `Your username is "${env.BOT_USERNAME}".\n`;
    context += `You are also known as "Trainer", "Sixth player" or "Sixth".\n`;
    const scriptValue = await env.KV.get("AI_REQUEST_SCRIPT");
    if (scriptValue) {
        context += scriptValue;
    }
    if (rememberedContext.length) {
        context += 'You have notes of important facts you made:\n';
        context += '[NOTES BEGIN]\n';
        context += rememberedContext.join('\n\n') + '\n';
        context += '[NOTES END]\n\n';
    }
    if (chatHistory) {
        context += 'You have recent chat history with timestamps UTC+0:\n';
        context += '[HISTORY BEGIN]\n';
        context += chatHistory + '\n';
        context += '[HISTORY END]\n\n';
    }

    const geminiPayload = {contents: [{parts: [{text: context}]}]};
    console.log(`AI payload:\n` + JSON.stringify(geminiPayload));
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${env.GEMINI_API_KEY}`, {
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
    console.log(`AI response:\n` + JSON.stringify(geminiData));

    if (lines) {
        try {
            const replyObject = JSON.parse(lines.join('\n').trim())
            if (replyObject.add_note) await addMemoryEntries(env, chatId, replyObject.add_note);
            if (replyObject.message && replyObject.message_type != "skip") {
                if (replyObject.message_direct_refer > 90) return replyToChat(replyObject.message, true, true);
                else if (replyObject.message_direct_refer > 80) return replyToChat(replyObject.message, true, false);
            }
        } catch (error) {
            console.error(`Wrong ai reply format: ${error.message}`);
            console.info(`AI reply:\n${geminiData}`);
            return await finalize('Wrong ai reply format', {status: 200});
        }
    }
    return await finalize('No content to reply', {status: 200});
}

