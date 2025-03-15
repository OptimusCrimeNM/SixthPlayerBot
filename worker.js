export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const ENABLED_KEY = 'ENABLED'
      const REMEMBERED_CONTEXT_KEY_PREFIX = 'REMEMBERED_CONTEXT_'
      const CHAT_HISTORY_KEY_PREFIX = 'CHAT_HISTORY_';

      const update = await request.json();
      const message = update.message;

      if (!message || !message.text) {
        return new Response("No message found", { status: 200 });
      }

      async function replyToChat(replyText) {
        const botToken = env.TELEGRAM_BOT_TOKEN;
        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const telegramPayload = {
          chat_id: message.chat.id,
          text: replyText,
          reply_to_message_id: message.message_id,
        };
  
        await fetch(telegramApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(telegramPayload),
        });
  
        return new Response("OK", { status: 200 });
      }

      async function processCommand(chatId, text) {
        if (text.startsWith('/status')) {
          const enabledChatting = await env.DATA_STORAGE.get(ENABLED_KEY);
          return replyToChat(enabledChatting ? "Service running" : "Service not running")
        }
        else if (text.startsWith('/start')) {
          await env.DATA_STORAGE.put(ENABLED_KEY, true);
          return replyToChat("Service started")
        }
        else if (text.startsWith('/stop')) {
            await env.DATA_STORAGE.delete(ENABLED_KEY);
            return replyToChat("Service stopped")
        }
        else if (text.startsWith('/remember ')) {
          const rememberedContextKey = `${REMEMBERED_CONTEXT_KEY_PREFIX}${chatId}`;
          let value = await env.DATA_STORAGE.get(rememberedContextKey);
          const newValue = text.slice('/remember '.length).trim()
          if (newValue) {
            if (value) value += '\n' + newValue; else value = newValue;
            await env.DATA_STORAGE.put(rememberedContextKey, value);
            return replyToChat("Value remembered")
          }
          else {
            return replyToChat("Value not specified!")
          }
        }
        else if (text.startsWith('/forget ')) {
          const rememberedContextKey = `${REMEMBERED_CONTEXT_KEY_PREFIX}${chatId}`;
          const oldStorage = await env.DATA_STORAGE.get(rememberedContextKey);
          let value = oldStorage ? oldStorage.split('\n') : [];
          const index = value.indexOf(text.slice('/forget '.length).trim());
          if (index !== -1) {
            value.splice(index, 1);
            await env.DATA_STORAGE.put(rememberedContextKey, value.join('\n'));
            return replyToChat("Value forgot")
          }
          else {
            return replyToChat("Value not found!")
          }
        }
        else if (text.startsWith('/clear')) {
          const rememberedContextKey = `${REMEMBERED_CONTEXT_KEY_PREFIX}${chatId}`;
          await env.DATA_STORAGE.delete(rememberedContextKey);
          return replyToChat("Memory cleared")
        }
        return new Response("OK", { status: 200 });
      }

      async function getChatHistory(chatId, currentMessage, currentUserId, maxChars = 8192) {
        const chatHistoryKey = `${CHAT_HISTORY_KEY_PREFIX}${chatId}`;
        let history = await env.DATA_STORAGE.get(chatHistoryKey) || '';
        let messages = history ? history.split('\n').filter(m => m) : [];

        // Format current message with username or "I say:"
        const from = message.from || {};
        const username = from.username ? `@${from.username}` : (from.first_name || 'Unknown');
        const formattedCurrentMessage = from.id === currentUserId ? `I say: ${currentMessage}` : `${username}: ${currentMessage}`;

        // Add current message to history
        messages.push(formattedCurrentMessage);

        // Find the most recent /start (checking both formats)
        const startIndex = messages.lastIndexOf('I say: /start') === -1 
          ? messages.lastIndexOf('/start') 
          : messages.lastIndexOf('I say: /start');
        const relevantMessages = startIndex === -1 ? messages : messages.slice(startIndex + 1);

        // Trim to fit maxChars
        let totalChars = 0;
        const trimmedMessages = [];
        for (let i = relevantMessages.length - 1; i >= 0; i--) {
          const msg = relevantMessages[i];
          if (totalChars + msg.length <= maxChars) {
            trimmedMessages.unshift(msg);
            totalChars += msg.length + 1; // +1 for newline
          } else {
            break;
          }
        }

        // Update stored history (keep all messages)
        await env.DATA_STORAGE.put(chatHistoryKey, messages.join('\n'));
        return trimmedMessages;
      }

      async function processWithAi(text) {
        const geminiApiKey = env.GEMINI_API_KEY;
        const geminiApiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
        // Get chat history and remembered context
        const chatId = String(message.chat.id);
        const chatHistory = await getChatHistory(chatId, text);
        const rememberedContextKey = `${REMEMBERED_CONTEXT_KEY_PREFIX}${chatId}`;
        const rememberedContext = await env.DATA_STORAGE.get(rememberedContextKey) || '';
        
        // Build context
        let context = "Previous chat messages:\n" + chatHistory.join('\n');
        if (rememberedContext) {
          context += "\n\nRemembered values:\n" + rememberedContext;
        }
        context += "\n\nCurrent message:\n" + text;
        context += "\n\nPlease, reply to the current message in it's language."

        const geminiPayload = {
          contents: [
            {
              parts: [
                { text: context },
              ],
            },
          ],
        };

        const geminiResponse = await fetch(`${geminiApiUrl}?key=${geminiApiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(geminiPayload),
        });

        if (!geminiResponse.ok) {
          throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const geminiData = await geminiResponse.json();
        const geminiReplyText = geminiData.candidates[0].content.parts[0].text;

        return replyToChat(geminiReplyText);
      }

      const chatId = message.chat.id;
      const chatType = message.chat.type; // 'private', 'group', 'supergroup', or 'channel'
      const allowedChat = chatId == env.ALLOWED_GROUP_ID || chatId == env.OWNER_ID

      if (allowedChat) {
        const text = message.text;
        if (text.startsWith('/')) {
          return processCommand(String(message.chat.id), text);
        }
        const enabledChatting = await env.DATA_STORAGE.get(ENABLED_KEY);
        if (enabledChatting) {
          return processWithAi(text);
        }
      }
      else if (chatType === 'private') {
        return replyToChat("Ты кто такой чтобы это делать?!")
      }
      return new Response("OK", { status: 200 });

    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};
