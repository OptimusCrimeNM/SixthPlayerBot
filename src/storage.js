import {MAX_CHAT_HISTORY_CHARS} from './constants.js';

export async function getChatHistory(env, chatId, maxChars = MAX_CHAT_HISTORY_CHARS) {
    try {
        const {results} = await env.DB.prepare(`
            SELECT m.message_text,
                   m.username,
                   m.message_id,
                   m.reply_to_message_id,
                   m.timestamp,
                   r.message_text AS reply_to_text,
                   r.username     AS reply_to_username
            FROM messages m
                     LEFT JOIN messages r ON m.reply_to_message_id = r.message_id AND m.chat_id = r.chat_id
            WHERE m.chat_id = ?
            ORDER BY m.timestamp DESC
        `).bind(chatId).all();

        let totalChars = 0;
        const dialog = [];
        const usedMessageIds = new Set(); // Track message IDs used in history

        // Process messages in reverse chronological order, then reverse for natural reading
        for (const row of results.reverse()) {
            const {
                message_text,
                username,
                message_id,
                reply_to_message_id,
                timestamp,
                reply_to_text,
                reply_to_username
            } = row;

            if (!message_text) continue; // Skip empty messages

            // Format the timestamp (e.g., "2025-03-16 14:30:45")
            const timecode = new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);

            // Split message_text into lines for formatting
            const lines = message_text.split('\n');
            let formattedMessage = `[${timecode}] ${username} writes:\n${lines.join('\n')}`;

            // Add reply context if applicable
            if (reply_to_message_id && reply_to_text && reply_to_username) {
                const replyLines = reply_to_text.split('\n');
                const truncatedReply = replyLines[0].length > 20 ? `${replyLines[0].slice(0, 20)}...` : replyLines[0];
                formattedMessage = `[${timecode}] ${username} replies to ${reply_to_username} "${truncatedReply}":\n${lines.join('\n')}`;
            }

            // Check character limit
            const messageLength = formattedMessage.length;
            if (totalChars + messageLength <= maxChars) {
                dialog.push(formattedMessage);
                totalChars += messageLength + 1; // Add 1 for newline between messages
                usedMessageIds.add(String(message_id)); // Ensure string type
                if (reply_to_message_id) usedMessageIds.add(String(reply_to_message_id)); // Ensure string type
            } else {
                break;
            }
        }
/*
        // Delete up to 10 oldest messages not used in the history
        if (usedMessageIds.size > 0) {
            // Fetch all message IDs and timestamps for this chat
            const allMessages = await env.DB.prepare(`
                SELECT message_id, timestamp
                FROM messages
                WHERE chat_id = ?
            `).bind(chatId).all();

            // Filter out messages not in usedMessageIds, sort by timestamp (oldest first), and take up to 10
            const messagesToDelete = allMessages.results
                .filter(row => !usedMessageIds.has(String(row.message_id))) // Ensure string comparison
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) // Oldest first (ascending)
                .slice(0, 10) // Limit to 10
                .map(row => ({message_id: row.message_id, timestamp: row.timestamp}));

            // Log what’s being deleted
            console.log(`Messages to delete from chat ${chatId}:`, messagesToDelete);

            // Delete each message individually
            const deleteStmt = env.DB.prepare(`
                DELETE
                FROM messages
                WHERE chat_id = ?
                  AND message_id = ?
            `);
            for (const {message_id} of messagesToDelete) {
                await deleteStmt.bind(chatId, message_id).run();
            }
        }
*/
        return dialog.join('\n\n');
    } catch (error) {
        console.error(`Error during history fetching or cleanup: ${error.message}`);
        return "";
    }
}

export async function getChatMemory(env, chatId) {
    try {
        const {results} = await env.DB.prepare(`
            SELECT id, context_value
            FROM remembered_context
            WHERE chat_id = ?
            ORDER BY id ASC
        `).bind(chatId).all();

        if (!results || results.length === 0) return "";

        // Format memory entries with their note numbers
        const memoryLines = results.map(row => `${row.id}. ${row.context_value}`);
        return memoryLines.join('\n');
    } catch (error) {
        console.error(`Error fetching chat memory for chat ${chatId}: ${error.message}`);
        return "";
    }
}

export async function removeMemoryEntries(env, chatId, entryNumbers) {
    if (!Array.isArray(entryNumbers) || entryNumbers.length === 0) return;

    try {
        const placeholders = entryNumbers.map(() => '?').join(',');
        await env.DB.prepare(`
            DELETE
            FROM remembered_context
            WHERE chat_id = ?
              AND id IN (${placeholders})
        `).bind(chatId, ...entryNumbers).run();
    } catch (error) {
        console.error(`Error removing memory entries for chat ${chatId}: ${error.message}`);
    }
}

export async function addMemoryEntries(env, chatId, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;

    try {
        const stmt = env.DB.prepare(`
            INSERT INTO remembered_context (chat_id, context_value)
            VALUES (?, ?)
        `);
        for (const entry of entries) {
            if (typeof entry === 'string' && entry.trim()) {
                await stmt.bind(chatId, entry.trim()).run();
            }
        }
    } catch (error) {
        console.error(`Error adding memory entries for chat ${chatId}: ${error.message}`);
    }
}