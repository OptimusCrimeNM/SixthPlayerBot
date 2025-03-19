import {getChatMemory} from "./storage";

export async function processCommand(env, chatId, text, replyToChat) {
    const ownerUserId = await env.KV.get("OWNER_USER_ID");
    const isOwner = ownerUserId === chatId;
    if (isOwner) {
        if (text.startsWith('/getPromt')) {
            const scriptText = await env.KV.get("AI_REQUEST_SCRIPT");
            return replyToChat(scriptText ? scriptText : "");
        } else if (text.startsWith('/setPromt')) {
            const newValue = text.slice('/setPromt'.length).trim();
            await env.KV.put("AI_REQUEST_SCRIPT", newValue);
            return replyToChat("Promt set");
        } else if (text.startsWith('/getChats')) {
            const {results} = await env.DB.prepare(`
                SELECT chat_id
                FROM chats
            `).bind(chatId).all();
            const memoryLines = results.map(row => `${row.chat_id}`);
            return replyToChat(memoryLines.join('\n'));
        } else if (text.startsWith('/getMemory')) {
            const requiredChatId = text.slice('/getMemory'.length).trim();
            return replyToChat(getChatMemory(env, requiredChatId));
        }
    }

    if (text.startsWith('/status')) {
        const {enabled} = await env.DB.prepare(`
            SELECT enabled
            FROM chats
            WHERE chat_id = ?
        `).bind(chatId).first() || {enabled: false};
        return replyToChat(enabled ? 'Service running' : 'Service not running');
    } else if (text.startsWith('/start')) {
        await env.DB.prepare(`
            UPDATE chats
            SET enabled = TRUE
            WHERE chat_id = ?
        `).bind(chatId).run();
        return replyToChat('Service started');
    } else if (text.startsWith('/stop')) {
        await env.DB.prepare(`
            UPDATE chats
            SET enabled = FALSE
            WHERE chat_id = ?
        `).bind(chatId).run();
        return replyToChat('Service stopped');
    } else if (text.startsWith('/remember')) {
        const newValue = text.slice('/remember'.length).trim();
        if (newValue) {
            await env.DB.prepare(`
                INSERT INTO remembered_context (chat_id, context_value)
                VALUES (?, ?)
            `).bind(chatId, newValue).run();
            return replyToChat('Value remembered');
        }
        return replyToChat('Value not specified!');
    } else if (text.startsWith('/drop_memory')) {
        await env.DB.prepare(`
            DELETE
            FROM remembered_context
            WHERE chat_id = ?
        `).bind(chatId).run();
        return replyToChat('Memory cleared');
    } else if (text.startsWith('/clear')) {
        await env.DB.prepare(`
            DELETE
            FROM messages
            WHERE chat_id = ?
        `).bind(chatId).run();
        return replyToChat('History cleared');
    }
    return new Response('OK', {status: 200});
}
