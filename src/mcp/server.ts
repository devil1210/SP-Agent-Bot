import { registry, executeTool } from '../tools/index.js';

/**
 * Adaptador MCP para exponer las herramientas existentes del bot
 */

export const listTools = () => {
    return registry.getToolNames().map(name => {
        const tool = registry.getTool(name)!;
        return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters // MCP espera 'inputSchema'
        };
    });
};

export const callTool = async (
    name: string, 
    args: any, 
    context: { 
        chatId: string, 
        userId: string, 
        threadId?: string, 
        quotedMsgId?: number, 
        qIsAssistant?: boolean, 
        isAdmin: boolean 
    }
) => {
    if (!registry.getTool(name)) {
        throw new Error(`Herramienta no encontrada: ${name}`);
    }
    return await executeTool(name, args, context);
};
