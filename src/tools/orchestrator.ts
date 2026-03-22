import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

const execPromise = promisify(exec);

interface ToolContext { 
    chatId: string; 
    userId: string; 
    threadId?: string; 
    isAdmin: boolean; 
}

const getProjectsPath = () => path.join(process.cwd(), config.projectsRootPath);

export const orchestratorTools = {
  clone_repository: {
    name: 'clone_repository',
    description: 'Clona un repositorio de GitHub en la carpeta de proyectos configurada.',
    parameters: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string' },
        folderName: { type: 'string' }
      },
      required: ['repoUrl', 'folderName']
    },
    execute: async (args: { repoUrl: string; folderName: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      const targetDir = path.join(getProjectsPath(), args.folderName);
      if (fs.existsSync(targetDir)) return "Error: La carpeta ya existe.";
      
      try {
        await execPromise(`git clone ${args.repoUrl} "${targetDir}"`);
        return `✅ Repositorio clonado en ${targetDir}`;
      } catch (e: any) {
        return `❌ Error al clonar: ${e.message}`;
      }
    }
  },
  
  modify_file: {
    name: 'modify_file',
    description: 'Modifica un archivo dentro de un repositorio.',
    parameters: {
      type: 'object',
      properties: {
        folderName: { type: 'string' },
        filePath: { type: 'string' },
        oldString: { type: 'string' },
        newString: { type: 'string' }
      },
      required: ['folderName', 'filePath', 'oldString', 'newString']
    },
    execute: async (args: { folderName: string; filePath: string; oldString: string; newString: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      const fullPath = path.join(getProjectsPath(), args.folderName, args.filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const newContent = content.replace(args.oldString, args.newString);
        fs.writeFileSync(fullPath, newContent, 'utf8');
        return "✅ Archivo modificado exitosamente.";
      } catch (e: any) {
        return `❌ Error al editar: ${e.message}`;
      }
    }
  },

  commit_and_push: {
    name: 'commit_and_push',
    description: 'Realiza git add, commit y push.',
    parameters: {
      type: 'object',
      properties: {
        folderName: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['folderName', 'message']
    },
    execute: async (args: { folderName: string; message: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      const targetDir = path.join(getProjectsPath(), args.folderName);
      try {
        await execPromise(`git -C "${targetDir}" add .`);
        await execPromise(`git -C "${targetDir}" commit -m "${args.message}"`);
        await execPromise(`git -C "${targetDir}" push`);
        return "✅ Cambios enviados a GitHub exitosamente.";
      } catch (e: any) {
        return `❌ Error al hacer commit/push: ${e.message}`;
      }
    }
  },

  spawn_coding_agent: {
    name: 'spawn_coding_agent',
    description: 'Inicia un agente de codificación (Codex/Claude) en background con soporte PTY.',
    parameters: {
      type: 'object',
      properties: {
        agentType: { type: 'string', enum: ['codex', 'claude', 'pi'], description: 'Tipo de agente' },
        prompt: { type: 'string', description: 'Tarea para el agente' },
        workdir: { type: 'string', description: 'Directorio relativo en la carpeta de proyectos' }
      },
      required: ['agentType', 'prompt', 'workdir']
    },
    execute: async (args: { agentType: string; prompt: string; workdir: string }, context: ToolContext) => {
      if (!context.isAdmin) return "Error: No autorizado.";
      
      const fullWorkdir = path.join(getProjectsPath(), args.workdir);
      const command = `CODING_AGENT_API_KEY='${config.codingAgentApiKey}' ${args.agentType} exec --full-auto '${args.prompt}'`;
      
      return `🚀 [TÉCNICO] Instrucción lista para el orquestador:\n` +
             `bash pty:true workdir:${fullWorkdir} background:true command:"${command}"`;
    }
  }
};
