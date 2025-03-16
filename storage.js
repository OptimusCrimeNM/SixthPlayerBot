import { MAX_CHAT_HISTORY_CHARS } from './constants.js';

export async function getChatHistory(env, chatId, maxChars = MAX_CHAT_HISTORY_CHARS) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT m.message_text, m.username, m.message_id, m.reply_to_message_id,
             r.message_text AS reply_to_text, r.username AS reply_to_username
      FROM messages m
      LEFT JOIN messages r ON m.reply_to_message_id = r.message_id AND m.chat_id = r.chat_id
      WHERE m.chat_id = ?
      AND m.message_text NOT LIKE '/start'
      ORDER BY m.timestamp DESC
    `).bind(chatId).all();

    let totalChars = 0;
    const dialog = [];
    const usedMessageIds = new Set(); // Track message IDs used in history

    // Process messages in reverse chronological order, then reverse for natural reading
    for (const row of results.reverse()) {
      const { message_text, username, message_id, reply_to_message_id, reply_to_text, reply_to_username } = row;

      if (!message_text) continue; // Skip empty messages

      // Split message_text into lines for formatting
      const lines = message_text.split('\n');
      let formattedMessage = `${username} writes:\n${lines.join('\n')}`;

      // Add reply context if applicable
      if (reply_to_message_id && reply_to_text && reply_to_username) {
        const replyLines = reply_to_text.split('\n');
        const truncatedReply = replyLines[0].length > 20 ? `${replyLines[0].slice(0, 20)}...` : replyLines[0];
        formattedMessage = `${username} replies to ${reply_to_username} "${truncatedReply}":\n${lines.join('\n')}`;
      }

      // Check character limit
      const messageLength = formattedMessage.length;
      if (totalChars + messageLength <= maxChars) {
        dialog.push(formattedMessage);
        totalChars += messageLength + 1; // Add 1 for newline between messages
        usedMessageIds.add(message_id); // Track this message as used
        if (reply_to_message_id) usedMessageIds.add(reply_to_message_id); // Track replied-to message
      } else {
        break;
      }
    }

    // Delete messages not used in the history
    if (usedMessageIds.size > 0) {
      await env.DB.prepare(`
        DELETE FROM messages
        WHERE chat_id = ?
        AND message_id NOT IN (${Array.from(usedMessageIds).map(() => '?').join(',')})
        AND message_text NOT LIKE '/start'
      `).bind(chatId, ...Array.from(usedMessageIds)).run();
    } else {
      // If no messages are used (e.g., all exceed maxChars), keep them for now or handle differently
      console.log(`No messages used in history for chat ${chatId}, skipping deletion`);
    }

    return dialog.join('\n\n');
  } catch (error) {
    console.error(`Error during history fetching or cleanup: ${error.message}`);
    return "";
  }
}
