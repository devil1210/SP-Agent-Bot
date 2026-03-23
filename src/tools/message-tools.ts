export const messageTools = {
  enviar_mensaje_grupo: {
    name: 'enviar_mensaje_grupo',
    description: 'Envía un mensaje a un grupo/hilo autorizado específico.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del grupo' },
        threadId: { type: 'number', description: 'ID del hilo (opcional)' },
        mensaje: { type: 'string', description: 'Contenido del mensaje' }
      },
      required: ['chatId', 'mensaje']
    },
    execute: async ({ chatId, threadId, mensaje }: any, { isAdmin }: any) => {
      if (!isAdmin) return 'Error: Solo el administrador puede enviar mensajes remotos.';
      try {
        const { getAuthorizedGroups } = await import('../db/settings.js');
        const { bot } = await import('../bot/index.js');
        const authorized = await getAuthorizedGroups();
        if (!authorized.includes(chatId)) return 'Error: El grupo no está autorizado.';
        const sent = await bot.api.sendMessage(chatId, mensaje, { message_thread_id: threadId, parse_mode: 'HTML' });
        const { addMemory } = await import('../db/index.js');
        await addMemory(chatId, 'assistant', mensaje, threadId?.toString(), sent.message_id);
        return `✅ Mensaje enviado con éxito al grupo ${chatId}.`;
      } catch (e: any) {
        return `❌ Error al enviar mensaje: ${e.message}`;
      }
    }
  },

  editar_mensaje_propio: {
    name: 'editar_mensaje_propio',
    description: 'Edita el contenido de tu último mensaje enviado en este chat o hilo.',
    parameters: {
      type: 'object',
      properties: {
        nuevo_texto: { type: 'string', description: 'Contenido corregido' },
        chatId: { type: 'string', description: 'Chat ID (opcional)' }
      },
      required: ['nuevo_texto']
    },
    execute: async ({ nuevo_texto, chatId: targetChatId }: any, { chatId: currentChatId, isAdmin }: any) => {
      if (!isAdmin) return 'Error: Solo el administrador puede editar mensajes.';
      try {
        const finalChatId = targetChatId || currentChatId;
        const { getHistory } = await import('../db/index.js');
        const { bot } = await import('../bot/index.js');
        const history = await getHistory(finalChatId, 10);
        const lastAssistantMsg = history.filter((m: any) => m.role === 'assistant' && m.msg_id).pop();
        if (!lastAssistantMsg?.msg_id) return `No encontré ningún mensaje reciente tuyo en ${finalChatId} que pueda editar.`;
        await bot.api.editMessageText(finalChatId, Number(lastAssistantMsg.msg_id), nuevo_texto, { parse_mode: 'HTML' });
        return '✅ Mensaje editado correctamente.';
      } catch (e: any) {
        return `❌ Error al editar mensaje: ${e.message}`;
      }
    }
  },

  borrar_mensaje_propio: {
    name: 'borrar_mensaje_propio',
    description: 'Elimina tu último mensaje enviado (o uno específico por ID) en este chat.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'ID del chat (opcional)' },
        messageId: { type: 'number', description: 'ID del mensaje a borrar (opcional)' }
      }
    },
    execute: async ({ chatId: targetChatId, messageId }: any, { chatId: currentChatId, isAdmin }: any) => {
      if (!isAdmin) return 'Error: Solo el administrador puede borrar mensajes.';
      try {
        const finalChatId = targetChatId || currentChatId;
        const { bot } = await import('../bot/index.js');
        const { getHistory } = await import('../db/index.js');
        let msgToDelete = messageId;
        if (!msgToDelete) {
          const history = await getHistory(finalChatId, 10);
          const lastAssistantMsg = history.filter((m: any) => m.role === 'assistant' && m.msg_id).pop();
          if (!lastAssistantMsg?.msg_id) return 'No encontré mensajes tuyos para borrar.';
          msgToDelete = Number(lastAssistantMsg.msg_id);
        }
        await bot.api.deleteMessage(finalChatId, msgToDelete);
        return '[SILENCE]';
      } catch (e: any) {
        return `❌ Error al borrar: ${e.message}`;
      }
    }
  },

  limpiar_ultimo_seguimiento: {
    name: 'limpiar_ultimo_seguimiento',
    description: 'Borra los últimos N mensajes que tú (el bot) has enviado en este hilo.',
    parameters: {
      type: 'object',
      properties: {
        cantidad: { type: 'number', description: 'Número de mensajes tuyos a borrar (máx 5).' }
      },
      required: ['cantidad']
    },
    execute: async ({ cantidad }: any, { chatId, isAdmin }: any) => {
      if (!isAdmin) return 'Error: Solo el administrador puede limpiar hilos.';
      try {
        const { bot } = await import('../bot/index.js');
        const { getHistory } = await import('../db/index.js');
        const history = await getHistory(chatId, 50);
        const assistantMsgs = history
          .filter((m: any) => m.role === 'assistant' && m.msg_id)
          .reverse()
          .slice(0, Math.min(cantidad, 5));
        if (!assistantMsgs.length) return 'No encontré mensajes recientes para limpiar.';
        for (const msg of assistantMsgs) {
          try { await bot.api.deleteMessage(chatId, Number(msg.msg_id)); } catch (e) {}
        }
        return '[SILENCE]';
      } catch (e: any) {
        return `❌ Error en limpieza: ${e.message}`;
      }
    }
  },

  borrar_este_mensaje: {
    name: 'borrar_este_mensaje',
    description: 'Elimina el mensaje que el usuario está CITANDO (respondiendo).',
    parameters: { type: 'object', properties: {} },
    execute: async (_: any, { chatId, quotedMsgId, qIsAssistant }: any) => {
      try {
        if (!quotedMsgId) return 'No estás citando ningún mensaje para borrar.';
        if (!qIsAssistant) return 'Ese mensaje no es mío, no puedo borrarlo.';
        const { bot } = await import('../bot/index.js');
        await bot.api.deleteMessage(chatId, quotedMsgId);
        return '[SILENCE]';
      } catch (e: any) {
        return `❌ Error al borrar el mensaje citado: ${e.message}`;
      }
    }
  }
};