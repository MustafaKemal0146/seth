import React, { useMemo } from 'react';
import { Box, Text, Static } from 'ink';
import { useSethAgent, type UseSethAgentOptions } from './hooks/useSethAgent.js';
import { ChatMessage } from './ChatMessage.js';
import { InputComposer } from './InputComposer.js';
import { Spinner } from './components.js';
import type { ChatMessage as MessageType } from '../types.js';

export interface AppProps {
  agentOptions: UseSethAgentOptions;
}

interface StaticItem {
  type: 'message';
  id: string;
  message: MessageType;
}

export function App({ agentOptions }: AppProps) {
  const {
    history,
    isProcessing,
    streamingText,
    currentTool,
    sendMessage,
    abort,
  } = useSethAgent(agentOptions);

  // Sadece mesajları statik olarak render ediyoruz.
  // Logo ve giriş bilgileri zaten intro.ts tarafından (cli.ts içinde) basıldı.
  // Ink bunları tekrar basmamalı, aksi halde duplicate olur.
  // ⚡ Bolt Optimization: Memoize static items array creation to prevent mapping the entire history on every render chunk during streaming.
  const staticItems: StaticItem[] = useMemo(() => {
    return history.map((msg, i) => ({
      type: 'message',
      id: `msg-${i}`,
      message: msg
    } as StaticItem));
  }, [history]);

  return (
    <Box flexDirection="column" paddingX={0}>
      {/* 
        Static Render: Bitmiş mesajlar.
        İşlem tamamlandıkça buraya düşer ve terminale bir kez basılır.
      */}
      <Static items={staticItems}>
        {(item) => <ChatMessage key={item.id} message={item.message} />}
      </Static>

      {/* Dinamik Alan: Sadece en altta güncellenen kısımlar */}
      <Box flexDirection="column" paddingLeft={1}>
        {/* Canlı Akış (Streaming) */}
        {streamingText && (
          <ChatMessage 
            message={{ role: 'assistant', content: streamingText }} 
            isStreaming={true} 
          />
        )}

        {/* Tool Çağrısı - Sade terminal log stili */}
        {currentTool && (
          <Box marginLeft={2} marginBottom={1}>
            <Text color="yellow">⏺ </Text>
            <Text bold>{currentTool.name}</Text>
            <Text dimColor> · {JSON.stringify(currentTool.input).slice(0, 100)}...</Text>
          </Box>
        )}

        {/* İşlem Yapılıyor Spinner */}
        {isProcessing && !streamingText && !currentTool && (
          <Box marginLeft={2} marginBottom={1}>
            <Spinner thinking={true} />
          </Box>
        )}

        {/* Input Alanı */}
        <Box>
          <InputComposer 
            onSend={sendMessage} 
            isProcessing={isProcessing} 
            onAbort={abort} 
          />
        </Box>
      </Box>
    </Box>
  );
}
