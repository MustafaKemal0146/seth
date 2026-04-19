import React from 'react';
import { Box, Text } from 'ink';
import { useSethAgent, type UseSethAgentOptions } from './hooks/useSethAgent.js';
import { ChatMessage } from './ChatMessage.js';
import { InputComposer } from './InputComposer.js';
import { Spinner, ToolCallDisplay } from './components.js';

const SETH_ART = [
  ' ███████╗███████╗████████╗██╗  ██╗',
  ' ██╔════╝██╔════╝╚══██╔══╝██║  ██║',
  ' ███████╗█████╗     ██║   ███████║',
  ' ╚════██║██╔══╝     ██║   ██╔══██║',
  ' ███████║███████╗   ██║   ██║  ██║',
  ' ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝',
];

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
      {/* Header Art */}
      <Box flexDirection="column" marginBottom={2}>
        {SETH_ART.map((line, i) => (
          <Text key={i} color="red" bold>{line}</Text>
        ))}
        <Text color="red" dimColor>  HİÇBİR SİSTEM GÜVENLİ DEĞİLDİR</Text>
        <Box marginTop={1}>
          <Text color="blue">  ✦ {agentOptions.provider.name}/{agentOptions.model}</Text>
        </Box>
      </Box>

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
