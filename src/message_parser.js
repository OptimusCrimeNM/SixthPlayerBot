import {findBestPhotoSize} from "./utils";
import {processPhoto, processVoice} from "./ai";

export async function parseAndStoreMessage(env, message) {
    const fromUserId = message.from.id;
    const fromUsername = (String(fromUserId) === env.BOT_USER_ID && env.BOT_USERNAME)
        ? env.BOT_USERNAME
        : (message.from.username ? message.from.username : `User_${fromUserId}`);
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const repliedMessageId = message.reply_to_message ? message.reply_to_message.message_id : null;

    let messageContent = "";
    if (message.audio) messageContent += "<Attached audio>";
    if (message.animation) messageContent += "<Attached animation>";
    if (message.sticker) messageContent += "<Sent sticker>";
    if (message.document) messageContent += "<Attached document>";
    if (message.photo) {
        const photoSize = findBestPhotoSize(env, message.photo)
        const photoDescription = await processPhoto(env, photoSize);
        messageContent += `<Attached photo: ${photoDescription}>`;
    }
    if (message.voice) {
        const voiceTranscription = await processVoice(env, message.voice);
        messageContent += `<Attached voice message: ${voiceTranscription}>`;
    }
    if (message.poll) messageContent += "<Created poll>";
    if (message.location) messageContent += "<Attached location>";
    if (message.dice) messageContent += `<Thrown dice to ${message.dice.value}>`;
    if (messageContent.length > 0) messageContent += "\n";
    if (message.caption) messageContent += message.caption + '\n';
    if (message.text) messageContent += message.text;

    if (messageContent.length === 0) {
        return false;
    }

    try {
        const existing = await env.DB.prepare(`
            SELECT 1
            FROM messages
            WHERE chat_id = ?
              AND message_id = ?
        `).bind(chatId, messageId).first();

        if (!existing) {
            // Insert only if it doesn’t exist
            await env.DB.prepare(`
                INSERT INTO messages (chat_id, user_id, username, message_text, message_id, reply_to_message_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(chatId, fromUserId, fromUsername, messageContent, messageId, repliedMessageId).run();
            return true;
        } else {
            console.log(`Message ${messageId} in chat ${chatId} already exists, skipping.`);
            return false;
        }
    } catch (error) {
        console.error(`Failed to store message ${messageId} in chat ${chatId}: ${error.message}`);
        return false;
    }
}

export async function storeReaction(env, reactionUpdate) {
    const chatId = reactionUpdate.chat.id;
    const messageId = reactionUpdate.message_id;
    const userId = reactionUpdate.user.id;
    const reactions = reactionUpdate.new_reaction; // Array of { type, emoji } objects

    try {
        // Check if the message exists in the messages table
        const messageExists = await env.DB.prepare(`
            SELECT 1
            FROM messages
            WHERE chat_id = ?
              AND message_id = ?
        `).bind(chatId, messageId).first();

        if (!messageExists) {
            console.log(`Message ${messageId} in chat ${chatId} not found, skipping reaction storage.`);
            return false; // Skip storing reactions if the message doesn't exist
        }

        // Proceed with storing reactions
        const stmt = env.DB.prepare(`
            INSERT
            OR REPLACE INTO message_reactions (chat_id, message_id, user_id, reaction)
            VALUES (?, ?, ?, ?)
        `);

        for (const reaction of reactions) {
            if (reaction.type === 'emoji') {
                await stmt.bind(chatId, messageId, userId, reaction.emoji).run();
            }
        }
        return true;

    } catch (error) {
        console.error(`Failed to store reaction for message ${messageId} in chat ${chatId}: ${error.message}`);
        return false;
    }
}
