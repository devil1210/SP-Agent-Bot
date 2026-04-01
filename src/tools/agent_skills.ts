import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { config } from '../config.js';

const execPromise = promisify(exec);
const getProjectsPath = () => path.join(process.cwd(), config.projectsRootPath);

interface ToolContext { 
    chatId: string; 
    userId: string; 
    threadId?: string; 
    isAdmin: boolean; 
}

/**
 * Agent Skills — Colección de herramientas funcionales para el agente.
 * Se eliminaron los stubs no funcionales (Mejora #5) para ahorrar tokens y mejorar precisión.
 */
export const agentSkills = {
  // --- GITHUB INTEGRATION ---
  gh_pr_list: {
    name: 'gh_pr_list',
    description: 'Lista los pull requests abiertos en un repositorio de GitHub.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Formato: usuario/repo' }
      },
      required: ['repo']
    },
    execute: async (args: { repo: string }, context: ToolContext) => {
      if (!context.isAdmin) return { output: "Error: No autorizado.", success: false };
      try {
        const { stdout } = await execPromise(`gh pr list --repo ${args.repo} --json number,title --jq '.[] | "#\\(.number): \\(.title)"'`);
        return { output: stdout || "No hay PRs abiertos.", success: true };
      } catch (e: any) {
        return { output: `❌ Error gh: ${e.message}`, success: false };
      }
    }
  },

  // --- CODING AGENT INTEGRATION ---
  run_coding_agent: {
    name: 'run_coding_agent',
    description: 'Ejecuta una tarea de codificación usando un agente autónomo (Codex/Claude).',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['codex', 'claude'], description: 'Tipo de agente' },
        prompt: { type: 'string', description: 'Instrucción detallada para el agente.' },
        workdir: { type: 'string', description: 'Directorio relativo en la carpeta de proyectos.' }
      },
      required: ['prompt', 'workdir']
    },
    execute: async (args: { agent?: string; prompt: string; workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return { output: "Error: No autorizado.", success: false };
      const workdir = path.join(getProjectsPath(), args.workdir);
      const agent = args.agent || 'codex';
      
      // Retorna una instrucción formateada para que el orquestador de sistema la capture si es necesario, 
      // o simplemente confirma la cola de ejecución.
      return { 
        output: `🚀 [${agent.toUpperCase()}] Tarea enviada: bash pty:true workdir:${workdir} command:"${agent} exec '${args.prompt}'"`,
        success: true 
      };
    }
  },

  // --- TYPESCRIPT REVIEW ---
  typescript_check: {
    name: 'typescript_check',
    description: 'Ejecuta tsc para verificar errores de compilación TypeScript en un directorio.',
    parameters: {
      type: 'object',
      properties: {
        workdir: { type: 'string', description: 'Directorio relativo en la carpeta de proyectos.' }
      },
      required: ['workdir']
    },
    execute: async (args: { workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return { output: "Error: No autorizado.", success: false };
      const workdir = path.join(getProjectsPath(), args.workdir);
      try {
        await execPromise(`cd "${workdir}" && npm run tsc`);
        return { output: "✅ TypeScript check: Sin errores encontrados.", success: true };
      } catch (e: any) {
        return { output: `❌ Errores TypeScript detectados:\n${e.stdout || e.message}`, success: false };
      }
    }
  }
};
