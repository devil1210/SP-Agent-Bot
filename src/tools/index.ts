import { orchestratorTools } from './orchestrator.js';
import { agentSkills } from './agent_skills.js';
import { libraryTools } from './library-tools.js';
import { accessTools } from './access-tools.js';
import { searchTools } from './search-tools.js';
import { messageTools } from './message-tools.js';
import { memoryTools } from './memory-tools.js';
import { zeepubBridgeTools } from './zeepub-bridge-tool.js';
import { registry } from './registry.js';

/**
 * 🛠️ CENTRAL TOOL INDEX — Refactorizado (Mejora #8)
 * Ahora usa el registry singleton inspirado en SPcore-Nexus para la gestión centralizada.
 */

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

// ── REGISTRO DE TODAS LAS HERRAMIENTAS ──────────────────────────────────────
// Este registro permite al agente cargar herramientas bajo demanda si se apaga una feature.

registry.register(libraryTools);
registry.register(accessTools);
registry.register(searchTools);
registry.register(messageTools);
registry.register(memoryTools);
registry.register(orchestratorTools);
registry.register(agentSkills);
registry.register(zeepubBridgeTools);

// Re-exportar definiciones para el LLM (ahora a través del registry)
export const getToolsDefinition = (filter?: (name: string) => boolean) => {
  return registry.getDefinitions(filter);
};

// ── EJECUCIÓN (Anti-Hang y Timeout Guard) ───────────────────────────────────
// Se mantiene la lógica de timeout aquí para separar la ejecución del registro puro.

const TOOL_TIMEOUT_MS = 15_000;

export const executeTool = async (
  name: string, 
  args: any, 
  context: { chatId: string; userId: string; threadId?: string; userMsgId?: number; quotedMsgId?: number; qIsAssistant?: boolean; isAdmin: boolean }

): Promise<ToolResult> => {
  
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
      registry.execute(name, parsedArgs, context),
      new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool '${name}' timeout after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS)
      )
    ]);

    const duration = Date.now() - start;
    console.log(`[Tool:Perf] ⏱️ ${name} completada en ${duration}ms`);

    return rawResult;

  } catch (e: any) {
    console.error(`[Tool:Error] ❌ ${name} falló tras ${Date.now() - start}ms: ${e.message}`);
    return { 
      output: `Error en herramienta '${name}': ${e.message}`, 
      success: false, 
      error: e.message 
    };
  }
};

// Re-exportar el registry para uso directo si es necesario
export { registry };
