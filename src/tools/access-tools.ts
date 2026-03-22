export const accessTools = {
    configurar_acceso_grupo: {
        name: 'configurar_acceso_grupo',
        description: 'Autoriza o revoca el acceso del bot a un grupo de Telegram usando su ID.',
        parameters: {
            type: 'object',
            properties: {
                chatId: { type: 'string', description: 'El ID del grupo (ej: -100123456789)' },
                accion: { type: 'string', enum: ['autorizar', 'revocar'], description: 'La acción a realizar' }
            },
            required: ['chatId', 'accion']
        },
        execute: async ({ chatId, accion }: any, { isAdmin }: any) => {
            if (!isAdmin) return 'Error: No tienes permisos para configurar el acceso de grupos.';
            try {
                const { authorizeGroup, revokeGroup } = await import('../db/settings.js');
                if (accion === 'autorizar') {
                    await authorizeGroup(chatId);
                    return `✅ Grupo ${chatId} autorizado exitosamente.`;
                } else {
                    await revokeGroup(chatId);
                    return `❌ Acceso revocado para el grupo ${chatId}.`;
                }
            } catch (err: any) {
                return `Error al configurar acceso: ${err.message}`;
            }
        }
    },
    configurar_autofix_twitter: {
        name: 'configurar_autofix_twitter',
        description: 'Activa o desactiva la corrección automática de enlaces de Twitter/X. Los ADMINISTRADORES pueden aplicarlo a otros si conocen su ID.',
        parameters: {
            type: 'object',
            properties: {
                activar: { type: 'boolean', description: 'Si es true, se activa el auto-fix; si es false, se desactiva.' },
                targetUserId: { type: 'string', description: 'Opcional. ID del usuario a configurar (solo para ADMINISTRADORES).' }
            },
            required: ['activar']
        },
        execute: async ({ activar, targetUserId }: any, { userId, isAdmin }: any) => {
            const finalUserId = (isAdmin && targetUserId) ? targetUserId : userId;
            try {
                const { setTwitterAutoFix } = await import('../db/index.js');
                await setTwitterAutoFix(finalUserId, activar);
                return `✅ La corrección automática de enlaces de Twitter/X ha sido ${activar ? 'ACTIVADA' : 'DESACTIVADA'} para ${finalUserId === userId ? 'ti' : 'el usuario ' + finalUserId}.`;
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    },
    set_state: {
        name: 'set_state',
        description: 'Establece el estado emocional (humor, animo, reactividad) para un hilo específico. Solo para ADMINISTRADORES.',
        parameters: {
            type: 'object',
            properties: {
                chatId: { type: 'string', description: 'ID del chat' },
                threadId: { type: 'string', description: 'ID del hilo' },
                humor: { type: 'number', description: 'Humor (0-100)' },
                animo: { type: 'number', description: 'Animo (0-100)' },
                reactividad: { type: 'number', description: 'Reactividad (0-100)' }
            },
            required: ['chatId']
        },
        execute: async ({ chatId, threadId, humor, animo, reactividad }: any, { isAdmin }: any) => {
            if (!isAdmin) return 'Error: No autorizado.';
            const { setEmotionalState } = await import('../db/settings.js');
            await setEmotionalState(chatId, { humor, animo, reactividad }, threadId);
            return `✅ Estado emocional actualizado en ${chatId} (${threadId || 'Global'}).`;
        }
    },
    set_personality: {
        name: 'set_personality',
        description: 'Establece la personalidad base para un hilo específico. Solo para ADMINISTRADORES.',
        parameters: {
            type: 'object',
            properties: {
                chatId: { type: 'string', description: 'ID del chat' },
                threadId: { type: 'string', description: 'ID del hilo' },
                persona: { type: 'string', description: 'Instrucciones de personalidad' }
            },
            required: ['chatId', 'persona']
        },
        execute: async ({ chatId, threadId, persona }: any, { isAdmin }: any) => {
            if (!isAdmin) return 'Error: No autorizado.';
            const { setPersonality } = await import('../db/settings.js');
            await setPersonality(chatId, persona, threadId);
            return `✅ Personalidad actualizada en ${chatId} (${threadId || 'Global'}).`;
        }
    }
};