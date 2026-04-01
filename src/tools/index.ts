import { orchestratorTools } from './orchestrator.js';
import { agentSkills } from './agent_skills.js';
import { libraryTools } from './library-tools.js';
import { accessTools } from './access-tools.js';
import { searchTools } from './search-tools.js';
import { messageTools } from './message-tools.js';
import { memoryTools } from './memory-tools.js';
import { zeepubBridgeTools } from './zeepub-bridge-tool.js';

export interface ToolResult {
  output: string;
  success: boolean;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, context: any) => Promise<string | ToolResult>;
}

export const tools: Record<string, Tool> = {
  ...libraryTools,
  ...accessTools,
  ...searchTools,
  ...messageTools,
  ...memoryTools,
  ...orchestratorTools,
  ...agentSkills,
  ...zeepubBridgeTools   // Bridge to Zeepub-bot
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

const TOOL_TIMEOUT_MS = 15_000;

export const executeTool = async (name: string, args: any, context: { chatId: string; userId: string; threadId?: string; quotedMsgId?: number; qIsAssistant?: boolean; isAdmin: boolean }): Promise<ToolResult> => {
  const tool = tools[name];
  if (!tool) return { output: `Tool ${name} not found`, success: false, error: 'NOT_FOUND' };

  let parsedArgs = args;
  if (typeof args === 'string') {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      parsedArgs = { query: args };
    }
  }

  const start = Date.now();
  try {
    const rawResult = await Promise.race([
      tool.execute(parsedArgs, context),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool '${name}' timeout after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS)
      )
    ]);

    const duration = Date.now() - start;
    console.log(`[Tool:Perf] ⏱️ ${name} completada en ${duration}ms`);

    // Normalizar resultado a ToolResult
    if (typeof rawResult === 'string') {
      return { output: rawResult, success: !rawResult.toLowerCase().includes('error:') };
    }
    return rawResult as ToolResult;

  } catch (e: any) {
    console.error(`[Tool:Error] ❌ ${name} falló tras ${Date.now() - start}ms: ${e.message}`);
    return { 
      output: `Error en herramienta '${name}': ${e.message}`, 
      success: false, 
      error: e.message 
    };
  }
};
