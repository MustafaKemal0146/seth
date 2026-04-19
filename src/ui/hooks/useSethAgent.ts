import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, LLMProvider, ToolCallRecord, TokenUsage, ContentBlock } from '../../types.js';
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
  const turnTextRef = useRef(''); // Yarım kalan metni tutmak için ref

  const sendMessage = useCallback(async (text: string) => {
    if (isProcessing) return;

    setIsProcessing(true);
    setStreamingText('');
    setCurrentTool(null);
    turnTextRef.current = '';

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: text }
    ];
    setHistory(updatedHistory);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const loopOptions: AgentLoopOptions = {
        ...options,
        onText: (chunk) => {
          turnTextRef.current += chunk;
          setStreamingText(turnTextRef.current);
        },
        onToolCall: (name, input) => {
          if (turnTextRef.current) {
            setHistory(prev => [...prev, { role: 'assistant', content: turnTextRef.current }]);
            turnTextRef.current = '';
            setStreamingText('');
          }
          setCurrentTool({ name, input });
        },
        onToolResult: (name, output, isError) => {
          setHistory(prev => [
            ...prev, 
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'auto', content: output, is_error: isError }] }
          ]);
          setCurrentTool(null);
        },
        onTurnStart: () => {
          turnTextRef.current = '';
          setStreamingText('');
        },
        abortSignal: controller.signal,
      };

      const result = await runAgentLoop(text, updatedHistory, loopOptions);
      
      setHistory(result.messages);
      setStreamingText('');
      setCurrentTool(null);
    } catch (err: any) {
      // Esc/Abort durumunda yarım kalan metni kurtar
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        const partialText = turnTextRef.current + ' [İŞLEM DURDURULDU]';
        setHistory(prev => [...prev, { role: 'assistant', content: partialText }]);
      } else {
        console.error('Agent loop error:', err);
        setHistory(prev => [...prev, { role: 'assistant', content: `Hata: ${err instanceof Error ? err.message : String(err)}` }]);
      }
    } finally {
      setIsProcessing(false);
      setStreamingText('');
      turnTextRef.current = '';
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
