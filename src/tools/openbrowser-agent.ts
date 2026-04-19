import type { ToolDefinition, ToolResult } from '../types.js';

export const openBrowserAgentTool: ToolDefinition = {
  name: 'openbrowser_agent',
  description: 'OpenBrowser AI agent — karmaşık web görevleri için akıllı otomasyon',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string' },
      url: { type: 'string' },
      maxSteps: { type: 'number', default: 15 },
      downloadDir: { type: 'string' }
    },
    required: ['task', 'url']
  },
  isDestructive: false,
  requiresConfirmation: true,
  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    return { output: `⚠️  OpenBrowser agent henüz tam entegre değil.\n\nGörev: ${input.task}\nURL: ${input.url}\n\nŞimdilik browser_automation kullanın.`, isError: false };
  }
};
