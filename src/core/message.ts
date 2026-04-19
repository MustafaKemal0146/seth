/**
 * @fileoverview Message utility functions.
 */

import type { ChatMessage, ContentBlock, TextBlock, ToolResultBlock } from '../types.js';

export function createUserMessage(text: string): ChatMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

export function createAssistantMessage(text: string): ChatMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

export function createSystemMessage(text: string): ChatMessage {
  return { role: 'system', content: text };
}

export function createToolResultMessage(toolUseId: string, output: string, isError = false): ChatMessage {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: output,
      is_error: isError,
    }],
  };
}

export function getTextContent(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

export function getToolUseBlocks(message: ChatMessage) {
  if (typeof message.content === 'string') return [];
  return message.content.filter(b => b.type === 'tool_use');
}

export function getToolResultBlocks(message: ChatMessage): ToolResultBlock[] {
  if (typeof message.content === 'string') return [];
  return message.content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
}

export function normalizeContent(content: ContentBlock[] | string): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}
