import React from 'react';
import { Box, Text } from 'ink';
import { useSethAgent, type UseSethAgentOptions } from './hooks/useSethAgent.js';
import { ChatMessage } from './ChatMessage.js';
import { InputComposer } from './InputComposer.js';
import { Spinner, ToolCallDisplay } from './components.js';

export interface AppProps {
  agentOptions: UseSethAgentOptions;
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

  return (
    <Box flexDirection="column" padding={1}>
      {/* Logo artık intro.ts tarafından hallediliyor, burada tekrar etmiyoruz */}
      
      {/* Mesaj Geçmişi */}
      {history.map((msg, i) => (
        <ChatMessage key={i} message={msg} />
      ))}

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
        <Box marginLeft={2}>
          <Spinner thinking={true} />
        </Box>
      )}

      {/* Input Alanı */}
      <InputComposer 
        onSend={sendMessage} 
        isProcessing={isProcessing} 
        onAbort={abort} 
      />
    </Box>
  );
}
