import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { ChatMessage as MessageType, ContentBlock } from '../types.js';

// Markdown'u terminal formatına (ANSI) çevirmek için ayarlar
marked.setOptions({
  renderer: new (TerminalRenderer as any)({
    reflowText: true,
    width: 80,
  })
});

export interface ChatMessageProps {
  message: MessageType;
  isStreaming?: boolean;
}

function renderContent(content: string | ContentBlock[]): string {
  let rawText = '';
  if (typeof content === 'string') {
    rawText = content;
  } else {
    rawText = content
      .filter(b => b.type === 'text' || b.type === 'tool_result')
      .map(b => {
        if (b.type === 'text') return b.text;
        if (b.type === 'tool_result') return `\n[ARAÇ ÇIKTISI]:\n${b.content}\n`;
        return '';
      })
      .join('');
  }

  // Markdown'u ANSI renk kodlarına çevir
  return marked.parse(rawText) as string;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? ' KULLANICI ' : ' SETH ';
  
  // Tema: Crimson Hacker (White text edition)
  const borderColor = isUser ? 'gray' : 'red';
  const labelBg = isUser ? 'white' : 'red';
  const labelText = isUser ? 'black' : 'white';

  const formattedText = renderContent(message.content).trim();
  if (!formattedText && !isStreaming) return null;

  if (message.role === 'system') return null;

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box paddingLeft={1}>
        <Text bold color={labelText} backgroundColor={labelBg}>
          {roleLabel}
        </Text>
      </Box>
      <Box 
        borderStyle="round" 
        borderColor={borderColor} 
        paddingX={1} 
        flexDirection="column"
      >
        <Text color="white">{formattedText}</Text>
        {isStreaming && <Text color="red">▋</Text>}
      </Box>
    </Box>
  );
}
