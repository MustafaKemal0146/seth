import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { ChatMessage as MessageType, ContentBlock } from '../types.js';

// Markdown ayarları: Sadece stil ver, yapısal kutulama yapma
const renderer = new (TerminalRenderer as any)({
  firstHeading: (s: string) => `\x1b[1;31m${s}\x1b[0m`, 
  heading: (s: string) => `\x1b[1;31m${s}\x1b[0m`,
  strong: (s: string) => `\x1b[1m${s}\x1b[22m`,       
  em: (s: string) => `\x1b[3m${s}\x1b[23m`,           
  codespan: (s: string) => `\x1b[33m${s}\x1b[39m`,    
  table: (s: string) => `\x1b[37m${s}\x1b[39m`,       
  listitem: (s: string) => `\x1b[31m•\x1b[0m \x1b[37m${s}\x1b[39m`,
  reflowText: false, // Tablo ve hizalamayı bozmaması için kapalı
  width: 76,
});

marked.setOptions({ renderer });

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
        if (b.type === 'tool_result') return `\n\x1b[1;31m[ARAÇ ÇIKTISI]:\x1b[0m\n${b.content}\n`;
        return '';
      })
      .join('');
  }

  // Markdown'u temizle ve ANSI'ye çevir
  const cleanedText = rawText.split('\n').map(l => l.trimEnd()).join('\n').trim();
  
  try {
    return marked.parse(cleanedText) as string;
  } catch {
    return rawText;
  }
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? ' KULLANICI ' : ' SETH ';
  
  const borderColor = isUser ? 'gray' : 'red';
  const labelBg = isUser ? 'white' : 'red';
  const labelText = isUser ? 'black' : 'white';

  const formattedText = renderContent(message.content);
  if (!formattedText && !isStreaming) return null;

  if (message.role === 'system') return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
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
        minWidth={20} // Çok daralmasın
      >
        <Text color="white">{formattedText}</Text>
        {isStreaming && <Text color="red">▋</Text>}
      </Box>
    </Box>
  );
}
