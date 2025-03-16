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
    if (message.photo) messageContent += "<Attached photo>";
    if (message.voice) messageContent += "<Attached voice message>";
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
        } else {
            console.log(`Message ${messageId} in chat ${chatId} already exists, skipping.`);
        }

        return true;
    } catch (error) {
        console.error(`Failed to store message ${messageId} in chat ${chatId}: ${error.message}`);
        return false;
    }
}
