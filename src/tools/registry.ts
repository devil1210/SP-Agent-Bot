import { Tool, ToolResult } from './index.js';

/**
 * 🛠️ EXECUTION REGISTRY — Patrón SPcore-Nexus
 * Gestiona el registro y ejecución centralizada de herramientas.
 */

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, Tool> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Registra una o varias herramientas
   */
  public register(toolOrTools: Tool | Tool[] | Record<string, Tool>): void {
    if (Array.isArray(toolOrTools)) {
      toolOrTools.forEach(t => this.tools.set(t.name, t));
    } else if (typeof toolOrTools === 'object' && !('name' in toolOrTools)) {
      Object.values(toolOrTools).forEach(t => this.tools.set(t.name, t));
    } else {
      const tool = toolOrTools as Tool;
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Obtiene la definición de todas las herramientas para el LLM
   */
  public getDefinitions(filter?: (name: string) => boolean) {
    const toolsToDefine = filter 
      ? Array.from(this.tools.values()).filter(t => filter(t.name))
      : Array.from(this.tools.values());

    return toolsToDefine.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }
    }));
  }

  /**
   * Ejecuta una herramienta por nombre
   */
  public async execute(name: string, args: any, context: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { output: `Tool '${name}' not found in registry.`, success: false, error: 'NOT_FOUND' };
    }

    try {
      const result = await tool.execute(args, context);
      if (typeof result === 'string') {
        return { output: result, success: !result.toLowerCase().includes('error:') };
      }
      return result;
    } catch (e: any) {
      return { output: `Execution error in '${name}': ${e.message}`, success: false, error: e.message };
    }
  }

  /**
   * Lista los nombres de todas las herramientas registradas
   */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Obtiene una herramienta específica
   */
  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}

// Exportar instancia única
export const registry = ToolRegistry.getInstance();
