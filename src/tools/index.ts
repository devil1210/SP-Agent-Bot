import { orchestratorTools } from './orchestrator.js';
import { agentSkills } from './agent_skills.js';
import { libraryTools } from './library-tools.js';
import { accessTools } from './access-tools.js';
import { searchTools } from './search-tools.js';
import { messageTools } from './message-tools.js';
import { memoryTools } from './memory-tools.js';

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
  ...agentSkills
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

  return await tool.execute(parsedArgs, context);
};
