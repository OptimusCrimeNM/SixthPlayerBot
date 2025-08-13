import {GEMINI_API_URL, TELEGRAM_API_BASE_URL} from './constants';
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
    return data.result;
}

export async function getFileLink(env, fileId) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const url = `${TELEGRAM_API_BASE_URL}${botToken}/getFile?file_id=${fileId}`;

    try {
        const response = await fetch(url, {method: 'GET'});
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

export async function processVoice(env, voice) {
    if (!voice || !voice.file_id) return "Couldn't process voice";

    const fileLink = await getFileLink(env, voice.file_id);
    if (!fileLink) return "Couldn't process voice";

    try {
        const voiceResponse = await fetch(fileLink);
        if (!voiceResponse.ok) {
            console.error(`Failed to fetch voice from ${fileLink}: ${voiceResponse.status}`);
            return "Couldn't process voice";
        }

        const voiceBuffer = await voiceResponse.arrayBuffer();
        const voiceArray = new Uint8Array(voiceBuffer);
        const binaryString = Array.from(voiceArray)
            .map(byte => String.fromCharCode(byte))
            .join('');
        const voiceBase64 = btoa(binaryString);

        const geminiApiKey = env.GEMINI_API_KEY;
        const geminiPayload = {
            contents: [
                {
                    parts: [
                        {text: "Transcript the voice audio, only the transcription is required."},
                        {
                            inline_data: {
                                mime_type: voice.mime_type,
                                data: voiceBase64
                            }
                        }
                    ]
                }
            ]
        };

        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(geminiPayload)
        });

        if (!geminiResponse.ok) {
            console.error(`Gemini API error: ${geminiResponse.status}`);
            return "Couldn't transcript voice";
        }

        const geminiData = await geminiResponse.json();
        const transcription = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No transcription available";

        return transcription;
    } catch (error) {
        console.error(`Error processing voice: ${error.message}`);
        return "Couldn't process voice";
    }
}

export async function processPhoto(env, photo) {
    if (!photo || !photo.file_id) return "Couldn't process photo";

    const fileLink = await getFileLink(env, photo.file_id);
    if (!fileLink) return "Couldn't process photo";

    try {
        const photoResponse = await fetch(fileLink);
        if (!photoResponse.ok) {
            console.error(`Failed to fetch photo from ${fileLink}: ${photoResponse.status}`);
            return "Couldn't process photo";
        }

        const photoBuffer = await photoResponse.arrayBuffer();
        const photoArray = new Uint8Array(photoBuffer);
        const binaryString = Array.from(photoArray)
            .map(byte => String.fromCharCode(byte))
            .join('');
        const photoBase64 = btoa(binaryString);

        const geminiApiKey = env.GEMINI_API_KEY;
        const geminiPayload = {
            contents: [
                {
                    parts: [
                        {text: "Describe this image. If it's funny, explain concisely the joke."},
                        {
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: photoBase64
                            }
                        }
                    ]
                }
            ]
        };

        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
    if (usersCount) context += `There are ${usersCount} users in the chat.\n`;
    if (env.BOT_USERNAME) context += `Your username is "${env.BOT_USERNAME}".\n`;
    context += `You are also known as "Trainer", "Sixth player", or "Sixth".\n`;
    const scriptValue = await env.KV.get("AI_REQUEST_SCRIPT");
    if (scriptValue) {
        context += scriptValue + '\n';
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
    context += 'Respond with a JSON object containing: message (string, the message to send or empty if no reply), message_type (string, set to "skip" to skip sending), message_direct_refer (number, sensitivity score for reply behavior), add_note (string, optional note to add to context), remove_note (string, optional note to remove from context).';

    const geminiPayload = {
        contents: [{parts: [{text: context}]}],
        generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
                type: 'object',
                properties: {
                    message: {type: 'string'},
                    message_type: {type: 'string'},
                    message_direct_refer: {type: 'number'},
                    add_note: {type: 'string', nullable: true},
                    remove_note: {type: 'string', nullable: true}
                },
                required: ['message', 'message_type', 'message_direct_refer']
            }
        }
    };

    console.log(`AI payload:\n${JSON.stringify(geminiPayload, null, 2)}`);

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(geminiPayload)
    });

    if (!geminiResponse.ok) {
        throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    let replyObject;
    try {
        replyObject = JSON.parse(geminiData.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error(`Failed to parse Gemini JSON response: ${error.message}`);
        console.info(`Raw Gemini response:\n${JSON.stringify(geminiData, null, 2)}`);
        return await finalize('Failed to parse AI response', {status: 200});
    }

    console.log(`Parsed AI response:\n${JSON.stringify(replyObject, null, 2)}`);

    try {
        if (replyObject.add_note) {
            await addMemoryEntries(env, chatId, replyObject.add_note);
        }
        if (replyObject.remove_note) {
            await removeMemoryEntries(env, chatId, replyObject.remove_note);
        }
        if (replyObject.message && replyObject.message_type !== "skip") {
            const limitSensMessage = parseInt(await env.KV.get("LIMIT_SENS_MESSAGE")) || 90;
            const limitSensMessageWithReply = parseInt(await env.KV.get("LIMIT_SENS_MESSAGE_REPLY")) || 50;
            if (replyObject.message_direct_refer > limitSensMessage) {
                return replyToChat(replyObject.message, true, true);
            } else if (replyObject.message_direct_refer > limitSensMessageWithReply) {
                return replyToChat(replyObject.message, true, false);
            }
        }
        return await finalize('No content to reply', {status: 200});
    } catch (error) {
        console.error(`Error processing AI response: ${error.message}`);
        console.info(`Parsed AI response:\n${JSON.stringify(replyObject, null, 2)}`);
        return await finalize('Error processing AI response', {status: 200});
    }
}