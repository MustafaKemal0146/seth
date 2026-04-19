import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage as MessageType, ContentBlock } from '../types.js';

export interface ChatMessageProps {
  message: MessageType;
  isStreaming?: boolean;
}

function renderContent(content: string | ContentBlock[]) {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('');
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? ' KULLANICI ' : ' SETH ';
  const roleColor = isUser ? 'cyan' : 'green';
  const borderColor = isUser ? 'blue' : 'green';

  const text = renderContent(message.content);

  if (message.role === 'system') return null;

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box paddingLeft={1}>
        <Text bold color={roleColor} backgroundColor={isUser ? 'blue' : 'black'}>
          {roleLabel}
        </Text>
      </Box>
      <Box 
        borderStyle="round" 
        borderColor={borderColor} 
        paddingX={1} 
        flexDirection="column"
      >
        <Text color="white">{text}</Text>
        {isStreaming && <Text color="green">▋</Text>}
      </Box>
    </Box>
  );
}
