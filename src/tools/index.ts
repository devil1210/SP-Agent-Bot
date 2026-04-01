import { orchestratorTools } from './orchestrator.js';
import { agentSkills } from './agent_skills.js';
import { libraryTools } from './library-tools.js';
import { accessTools } from './access-tools.js';
import { searchTools } from './search-tools.js';
import { messageTools } from './message-tools.js';
import { memoryTools } from './memory-tools.js';
import { zeepubBridgeTools } from './zeepub-bridge-tool.js';

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, context: any) => Promise<string>;
}

export const tools: Record<string, Tool> = {
  ...libraryTools,
  ...accessTools,
  ...searchTools,
  ...messageTools,
  ...memoryTools,
  ...orchestratorTools,
  ...agentSkills,
  ...zeepubBridgeTools   // 🌉 Puente MCP → Zeepub-bot
};

export const getToolsDefinition = () => {
  return Object.values(tools).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }
  }));
};

const TOOL_TIMEOUT_MS = 15_000; // 15 segundos — protección anti-hang

export const executeTool = async (name: string, args: any, context: { chatId: string; userId: string; threadId?: string; quotedMsgId?: number; qIsAssistant?: boolean; isAdmin: boolean }) => {
  const tool = tools[name];
  if (!tool) throw new Error(`Tool ${name} not found`);

  let parsedArgs = args;
  if (typeof args === 'string') {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      parsedArgs = { query: args };
    }
  }

  // Timeout guard (patrón Nexus — evita hang indefinido si un servicio externo no responde)
  const start = Date.now();
  try {
    const result = await Promise.race([
      tool.execute(parsedArgs, context),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool '${name}' timeout after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS)
      )
    ]);
    console.log(`[Tool:Perf] ⏱️ ${name} completada en ${Date.now() - start}ms`);
    return result;
  } catch (e: any) {
    console.error(`[Tool:Error] ❌ ${name} falló tras ${Date.now() - start}ms: ${e.message}`);
    return `Error en herramienta '${name}': ${e.message}`;
  }
};
