import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { ChatMessage as MessageType, ContentBlock } from '../types.js';

// Markdown ayarları: Sadece stil ver, yapısal kutulama yapma
const renderer = new (TerminalRenderer as any)({
  firstHeading: (s: string) => `\n\x1b[1;31m${s}\x1b[0m\n`, 
  heading: (s: string) => `\n\x1b[1;31m${s}\x1b[0m\n`,
  strong: (s: string) => `\x1b[1m${s}\x1b[22m`,       
  em: (s: string) => `\x1b[3m${s}\x1b[23m`,           
  codespan: (s: string) => `\x1b[33m${s}\x1b[39m`,    
  table: (s: string) => `\n\x1b[37m${s}\x1b[39m\n`,       
  listitem: (s: string) => `  \x1b[31m•\x1b[0m \x1b[37m${s}\x1b[39m`,
  reflowText: false,
  width: 80,
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
        if (b.type === 'tool_result') {
          // Tool sonuçlarını terminal log stiliyle gösteriyoruz
          return `\n\x1b[90m[!] ARAÇ ÇIKTISI:\x1b[0m\n${b.content}\n`;
        }
        return '';
      })
      .join('');
  }

  const cleanedText = rawText.split('\n').map(l => l.trimEnd()).join('\n').trim();
  
  try {
    return marked.parse(cleanedText) as string;
  } catch {
    return rawText;
  }
}

export const ChatMessage = React.memo(function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? ' > ' : ' ≻ ';
  const roleName = isUser ? 'KULLANICI' : 'SETH';
  const roleColor = isUser ? 'cyan' : 'red';

  // ⚡ Bolt Optimization: Memoize expensive markdown parsing based on message content identity
  const formattedText = useMemo(() => renderContent(message.content), [message.content]);

  if (!formattedText && !isStreaming) return null;

  if (message.role === 'system') return null;

  // Sade Terminal Tasarımı (Kutu Yok)
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={roleColor}>{roleName}</Text>
        <Text color="gray">{roleLabel}</Text>
        {isUser && <Text color="white">{formattedText}</Text>}
      </Box>
      {!isUser && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="white">{formattedText}</Text>
          {isStreaming && <Text color="red">▋</Text>}
        </Box>
      )}
    </Box>
  );
});
