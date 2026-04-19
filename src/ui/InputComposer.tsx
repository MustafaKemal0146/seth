import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputComposerProps {
  onSend: (text: string) => void;
  isProcessing: boolean;
  onAbort: () => void;
}

export function InputComposer({ onSend, isProcessing, onAbort }: InputComposerProps) {
  const [input, setInput] = useState('');

  useInput((inputStr, key) => {
    if (isProcessing) {
      if (key.escape) {
        onAbort();
      }
      return;
    }

    if (key.return) {
      if (input.trim()) {
        onSend(input.trim());
        setInput('');
      }
    } else if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
    } else if (key.ctrl && inputStr === 'c') {
      process.exit(0);
    } else if (!key.ctrl && !key.meta) {
      setInput(prev => prev + inputStr);
    }
  });

  return (
    <Box>
      <Text color="red" bold>{isProcessing ? '⚡ ' : '> '}</Text>
      <Text color="white">{input}</Text>
      {isProcessing && <Text dimColor color="red"> (Durdurmak için Esc)</Text>}
    </Box>
  );
}
