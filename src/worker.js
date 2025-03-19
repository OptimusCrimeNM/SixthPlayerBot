import {processCommand} from './commands.js';
import {processWithAi} from './ai.js';
import {parseAndStoreMessage, storeReaction} from './message_parser.js';
import {TELEGRAM_API_BASE_URL, UNAUTHORIZED_MESSAGE,} from './constants.js';

export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', {status: 405});
        }

        const contentType = request.headers.get('Content-Type');
        if (contentType !== 'application/json') {
            return new Response('Invalid Content-Type', {status: 400});
        }

        const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (env.WEBHOOK_SECRET && secretToken !== env.WEBHOOK_SECRET) {
            return new Response('Unauthorized', {status: 401});
        }

        try {
            const update = await request.json();
            const message = update.message || update.edited_message;
            if (message) {
                async function replyToChat(replyText, storeReply = false, replyToLatest = false) {
                    const botToken = env.TELEGRAM_BOT_TOKEN;
                    const telegramApiUrl = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;
                    const telegramPayload = {
                        chat_id: message.chat.id,
                        text: replyText,
                        reply_to_message_id: (replyToLatest ? message.message_id : undefined),
                    };

                    const replyRequest = await fetch(telegramApiUrl, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(telegramPayload),
                    });

                    if (!replyRequest.ok) {
                        const errorText = await replyRequest.text();
                        throw new Error(`Telegram API error: ${replyRequest.status} - ${errorText}`);
                    }

                    const sentMessage = await replyRequest.json();
                    if (storeReply && sentMessage && sentMessage.ok && sentMessage.result) {
                        await parseAndStoreMessage(env, sentMessage.result);
                    }

                    return new Response('OK', {status: 200});
                }

                const chatId = message.chat.id;
                const chatType = message.chat.type;

                await env.DB.prepare(`
                    INSERT
                    OR IGNORE INTO chats (chat_id, enabled, approved) VALUES (?, FALSE, FALSE)
                `).bind(chatId).run();
                const chatStatus = await env.DB.prepare(`
                    SELECT enabled, approved
                    FROM chats
                    WHERE chat_id = ?
                `).bind(chatId).first();

                if (chatStatus && chatStatus.approved) {
                    const text = message.text || '';
                    if (text.startsWith('/')) {
                        return processCommand(env, String(chatId), text, replyToChat);
                    }

                    const enabledChatting = chatStatus ? chatStatus.enabled : false;
                    if (enabledChatting && (await parseAndStoreMessage(env, message))) {
                        return processWithAi(env, chatId, replyToChat);
                    }
                } else if (chatType === 'private') {
                    return replyToChat(UNAUTHORIZED_MESSAGE);
                }
                return new Response('OK', {status: 200});
            }
            const reactionUpdate = update.message_reaction;
            if (reactionUpdate) {
                await storeReaction(env, reactionUpdate);
                return new Response('Ok', {status: 200});
            }
            return new Response('No message found', {status: 200});
        } catch (error) {
            console.error(`Error: ${error.message}`);
            return new Response(`Error: ${error.message}`, {status: 500});
        }
    },
};
