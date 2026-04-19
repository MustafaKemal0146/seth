import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, LLMProvider, ToolCallRecord, TokenUsage } from '../../types.js';
import { runAgentLoop, type AgentLoopOptions } from '../../agent/loop.js';
import { ToolRegistry } from '../../tools/registry.js';
import { ToolExecutor } from '../../tools/executor.js';

export interface UseSethAgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  maxTurns: number;
  maxTokens: number;
  cwd: string;
  debug: boolean;
  effort?: string;
}

export function useSethAgent(options: UseSethAgentOptions) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [currentTool, setCurrentTool] = useState<{ name: string; input: Record<string, unknown> } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (isProcessing) return;

    setIsProcessing(true);
    setStreamingText('');
    setCurrentTool(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const loopOptions: AgentLoopOptions = {
        ...options,
        onText: (chunk) => {
          setStreamingText(prev => prev + chunk);
        },
        onToolCall: (name, input) => {
          setCurrentTool({ name, input });
          setStreamingText(''); // Clear streaming text when tool starts
        },
        onToolResult: (name, output, isError) => {
          setCurrentTool(null);
        },
        onTurnStart: () => {
          setStreamingText('');
        },
        abortSignal: controller.signal,
      };

      const result = await runAgentLoop(text, history, loopOptions);
      
      setHistory(result.messages);
      setStreamingText('');
      setCurrentTool(null);
    } catch (err) {
      console.error('Agent loop error:', err);
      // Add error message to history
      setHistory(prev => [...prev, { role: 'assistant', content: `Hata: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }, [history, isProcessing, options]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    history,
    isProcessing,
    streamingText,
    currentTool,
    sendMessage,
    abort,
  };
}
