export async function processCommand(env, chatId, text, replyToChat) {
  if (text.startsWith('/status')) {
    const { enabled } = await env.DB.prepare(`
      SELECT enabled FROM chats WHERE chat_id = ?
    `).bind(chatId).first() || { enabled: false };
    return replyToChat(enabled ? 'Service running' : 'Service not running');
  } else if (text.startsWith('/start')) {
    await env.DB.prepare(`
      UPDATE chats SET enabled = TRUE WHERE chat_id = ?
    `).bind(chatId).run();
    return replyToChat('Service started');
  } else if (text.startsWith('/stop')) {
    await env.DB.prepare(`
      UPDATE chats SET enabled = FALSE WHERE chat_id = ?
    `).bind(chatId).run();
    return replyToChat('Service stopped');
  } else if (text.startsWith('/remember ')) {
    const newValue = text.slice('/remember '.length).trim();
    if (newValue) {
      await env.DB.prepare(`
        INSERT INTO remembered_context (chat_id, context_value) VALUES (?, ?)
      `).bind(chatId, newValue).run();
      return replyToChat('Value remembered');
    }
    return replyToChat('Value not specified!');
  } else if (text.startsWith('/forget ')) {
    const valueToForget = text.slice('/forget '.length).trim();
    const { success } = await env.DB.prepare(`
      DELETE FROM remembered_context WHERE chat_id = ? AND context_value = ?
    `).bind(chatId, valueToForget).run();
    return replyToChat(success ? 'Value forgot' : 'Value not found!');
  } else if (text.startsWith('/clear')) {
    await env.DB.prepare(`
      DELETE FROM remembered_context WHERE chat_id = ?
    `).bind(chatId).run();
    await env.DB.prepare(`
      DELETE FROM messages WHERE chat_id = ?
    `).bind(chatId).run();
    return replyToChat('Memory cleared');
  }
  return new Response('OK', { status: 200 });
}
