import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

interface ToolContext { 
    chatId: string; 
    userId: string; 
    threadId?: string; 
    isAdmin: boolean; 
}

export const orchestratorTools = {
  spawn_coding_agent: {
    name: 'spawn_coding_agent',
    description: 'Inicia un agente de codificación (Codex/Claude) en background con soporte PTY.',
    parameters: {
      type: 'object',
      properties: {
        agentType: { type: 'string', enum: ['codex', 'claude', 'pi'], description: 'Tipo de agente' },
        prompt: { type: 'string', description: 'Tarea para el agente' },
        workdir: { type: 'string', description: 'Directorio de trabajo dentro de /projects' }
      },
      required: ['agentType', 'prompt', 'workdir']
    },
    execute: async (args: { agentType: string; prompt: string; workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      
      const fullWorkdir = path.join(process.cwd(), 'projects', args.workdir);
      const command = `${args.agentType} exec --full-auto '${args.prompt}'`;
      
      // En un entorno real, aquí invocarías el bash tool con pty:true
      // Como estamos limitados por el entorno del bot, retornamos la instrucción técnica
      return `🚀 [TÉCNICO] Instrucción lista para el orquestador:\n` +
             `bash pty:true workdir:${fullWorkdir} background:true command:"${command}"`;
    }
  }
};
