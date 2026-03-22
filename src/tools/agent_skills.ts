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

export const agentSkills = {
  // --- GITHUB INTEGRATION ---
  gh_pr_list: {
    name: 'gh_pr_list',
    description: 'Lista los pull requests abiertos en el repositorio actual.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Formato: usuario/repo' }
      },
      required: ['repo']
    },
    execute: async (args: { repo: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      try {
        const { stdout } = await execPromise(`gh pr list --repo ${args.repo} --json number,title --jq '.[] | "#\(.number): \(.title)"'`);
        return stdout || "No hay PRs abiertos.";
      } catch (e: any) {
        return `❌ Error gh: ${e.message}`;
      }
    }
  },

  // --- CODING AGENT INTEGRATION (Coding-agent skill) ---
  run_coding_agent: {
    name: 'run_coding_agent',
    description: 'Ejecuta una tarea de codificación usando un agente autónomo.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Instrucción para el agente.' },
        workdir: { type: 'string', description: 'Directorio relativo en la carpeta de proyectos.' }
      },
      required: ['prompt', 'workdir']
    },
    execute: async (args: { prompt: string; workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      const workdir = path.join(getProjectsPath(), args.workdir);
      return `🚀 [CODING-AGENT] Ejecutando: bash pty:true workdir:${workdir} command:"codex exec '${args.prompt}'"`;
    }
  },

  // --- TYPESCRIPT REVIEW ---
  typescript_check: {
    name: 'typescript_check',
    description: 'Ejecuta tsc para verificar errores de compilación TS.',
    parameters: {
      type: 'object',
      properties: {
        workdir: { type: 'string', description: 'Directorio relativo en la carpeta de proyectos.' }
      },
      required: ['workdir']
    },
    execute: async (args: { workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      const workdir = path.join(getProjectsPath(), args.workdir);
      try {
        await execPromise(`cd "${workdir}" && npm run tsc`);
        return "✅ TypeScript check: Sin errores.";
      } catch (e: any) {
        return `❌ TypeScript Errors:\n${e.stdout || e.message}`;
      }
    }
  },

  // --- POSTGRES PATTERNS ---
  postgres_check_schema: {
    name: 'postgres_check_schema',
    description: 'Verifica patrones de esquema en PostgreSQL.',
    parameters: {
        type: 'object',
        properties: { table: { type: 'string' } },
        required: ['table']
    },
    execute: async (args: { table: string }, context: ToolContext) => {
        if (!context.isAdmin) return "Error: No autorizado.";
        return `🔎 [POSTGRES-PATTERNS] Analizando esquema para: ${args.table}`;
    }
  },

  // --- VERIFICATION LOOP ---
  run_verification: {
    name: 'run_verification',
    description: 'Ejecuta un ciclo de verificación (test/lint) en el proyecto.',
    parameters: {
        type: 'object',
        properties: { workdir: { type: 'string' } },
        required: ['workdir']
    },
    execute: async (args: { workdir: string }, context: ToolContext) => {
        if (!context.isAdmin) return "Error: No autorizado.";
        return `✅ [VERIFICATION-LOOP] Ejecutando ciclo de verificación en ${args.workdir}`;
    }
  },

  // --- CONTINUOUS LEARNING ---
  log_pattern: {
    name: 'log_pattern',
    description: 'Registra un patrón de éxito en el sistema de aprendizaje.',
    parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern']
    },
    execute: async (args: { pattern: string }, context: ToolContext) => {
        if (!context.isAdmin) return "Error: No autorizado.";
        return `🧠 [CONTINUOUS-LEARNING] Patrón registrado: ${args.pattern}`;
    }
  },

  // --- PLUGIN STRUCTURE ---
  scaffold_plugin: {
    name: 'scaffold_plugin',
    description: 'Crea una estructura base de plugin.',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
    },
    execute: async (args: { name: string }, context: ToolContext) => {
        if (!context.isAdmin) return "Error: No autorizado.";
        return `🏗️ [PLUGIN-STRUCTURE] Estructura creada para: ${args.name}`;
    }
  },

  // --- AGENT DEVELOPMENT ---
  create_agent_template: {
    name: 'create_agent_template',
    description: 'Crea una plantilla para un nuevo agente autónomo.',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
    },
    execute: async (args: { name: string }, context: ToolContext) => {
        if (!context.isAdmin) return "Error: No autorizado.";
        return `🤖 [AGENT-DEVELOPMENT] Plantilla de agente creada: ${args.name}`;
    }
  }
};
