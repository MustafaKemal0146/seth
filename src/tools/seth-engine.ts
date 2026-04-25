import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

let pythonWorker: ChildProcess | null = null;

function getWorker() {
  if (pythonWorker) return pythonWorker;
  
  pythonWorker = spawn('python3', ['SETH-Apps/Core/SETH_Engine.py'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });
  
  if (pythonWorker.stdout) {
    pythonWorker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'log') {
              const color = parsed.level === 'SUCCESS' ? '\x1b[32m' : parsed.level === 'ERROR' ? '\x1b[31m' : '\x1b[36m';
              console.log(`${color}[SETH-WORKER] [${parsed.timestamp}] [${parsed.level}] ${parsed.message}\x1b[0m`);
            }
          } catch (e) {
            // JSON değilse yoksay
          }
        }
      }
    });
  }

  return pythonWorker;
}

export const sethEngineSchema = z.object({
  target: z.string().describe('Operasyon yapılacak hedef IP veya domain'),
  action: z.enum(['nmap', 'nuclei', 'sqlmap', 'bypass_cloudflare', 'subdomain', 'whatweb', 'brute_force', 'dir_search', 'exploit_search', 'lateral_movement', 'config_audit', 'service_integrity', 'campaign', 'breach_query', 'get_map', 'exit']).describe('Yürütülecek siber operasyon eylemi'),
});

export async function sethEngine(input: Record<string, unknown>): Promise<ToolResult> {
  const args = sethEngineSchema.parse(input);
  const { target, action } = args;
  const worker = getWorker();
  
  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'result') {
            if (worker.stdout) worker.stdout.removeListener('data', onData);
            resolve({
              output: JSON.stringify(parsed, null, 2),
              isError: parsed.status === 'error'
            });
            return;
          }
        } catch (e) {
          // Yanıt JSON değilse devam et
        }
      }
    };

    if (worker.stdout) worker.stdout.on('data', onData);
    if (worker.stdin) worker.stdin.write(JSON.stringify({ action, target }) + '\n');
  });
}

export const sethEngineTool: ToolDefinition = {
  name: 'sethEngine',
  description: 'SETH Otonom Operasyon Motoru. Python Worker üzerinden Nmap, Nuclei ve Cloudflare Bypass araçlarını kontrol eder.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Operasyon yapılacak hedef IP veya domain' },
      action: {
        type: 'string',
        enum: ['nmap', 'nuclei', 'sqlmap', 'bypass_cloudflare', 'subdomain', 'whatweb', 'brute_force', 'dir_search', 'exploit_search', 'lateral_movement', 'config_audit', 'service_integrity', 'campaign', 'breach_query', 'get_map', 'exit'],
        description: 'Yürütülecek siber operasyon eylemi',
      },
    },
    required: ['target', 'action'],
  },
  execute: sethEngine,
};
