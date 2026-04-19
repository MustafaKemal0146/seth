import React from 'react';
import { Box, Text, Static } from 'ink';
import { useSethAgent, type UseSethAgentOptions } from './hooks/useSethAgent.js';
import { ChatMessage } from './ChatMessage.js';
import { InputComposer } from './InputComposer.js';
import { Spinner, ToolCallDisplay } from './components.js';
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
  // Logo ve giriş bilgileri zaten intro.ts tarafından terminale basıldı.
  const staticItems: StaticItem[] = history.map((msg, i) => ({ 
    type: 'message', 
    id: `msg-${i}`, 
    message: msg 
  } as StaticItem));

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 
        Static Render: Sadece bitmiş mesajlar.
        Yeni mesaj geldikçe buraya eklenir ve terminale bir kez basılır.
      */}
      <Static items={staticItems}>
        {(item) => <ChatMessage key={item.id} message={item.message} />}
      </Static>

      {/* 
        Dinamik Alan: Mevcut işlem durumu ve yeni mesaj girişi.
      */}
      <Box flexDirection="column">
        {/* Canlı Akış (Streaming) */}
        {streamingText && (
          <ChatMessage 
            message={{ role: 'assistant', content: streamingText }} 
            isStreaming={true} 
          />
        )}

        {/* Tool Çağrısı */}
        {currentTool && (
          <ToolCallDisplay name={currentTool.name} detail={JSON.stringify(currentTool.input)} />
        )}

        {/* İşlem Yapılıyor Spinner */}
        {isProcessing && !streamingText && !currentTool && (
          <Box marginLeft={2} marginBottom={1}>
            <Spinner thinking={true} />
          </Box>
        )}

        {/* Input Alanı */}
        <Box marginTop={history.length > 0 ? 1 : 0}>
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
