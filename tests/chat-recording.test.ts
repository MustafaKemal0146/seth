import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordMessage, readRecording } from '../src/chat-recording.js';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home')
}));

describe('chat-recording', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordMessage', () => {
    it('creates directory and writes correctly formatted JSON record', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.useFakeTimers();
      const mockDate = new Date('2024-01-01T12:00:00.000Z');
      vi.setSystemTime(mockDate);

      recordMessage('session-1', { role: 'user', content: 'hello world' }, 10);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.seth/recordings', { recursive: true });
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/mock/home/.seth/recordings/session-1.jsonl',
        JSON.stringify({
          timestamp: mockDate.toISOString(),
          sessionId: 'session-1',
          role: 'user',
          content: 'hello world',
          tokenCount: 10
        }) + '\n',
        'utf-8'
      );

      vi.useRealTimers();
    });

    it('truncates string content longer than 2000 characters', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const longContent = 'a'.repeat(2500);

      recordMessage('session-2', { role: 'assistant', content: longContent });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const appendCall = vi.mocked(fs.appendFileSync).mock.calls[0];
      const writtenData = JSON.parse(appendCall[1] as string);

      expect(writtenData.content.length).toBe(2000);
      expect(writtenData.content).toBe('a'.repeat(2000));
    });

    it('stringifies and truncates non-string content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const objContent = [{ type: 'text', text: 'hello' }];

      recordMessage('session-3', { role: 'user', content: objContent as any });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const appendCall = vi.mocked(fs.appendFileSync).mock.calls[0];
      const writtenData = JSON.parse(appendCall[1] as string);

      expect(writtenData.content).toBe(JSON.stringify(objContent));
    });

    it('handles appendFileSync errors silently', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      expect(() => {
        recordMessage('session-4', { role: 'user', content: 'test' });
      }).not.toThrow();
    });
  });

  describe('readRecording', () => {
    it('returns empty array when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = readRecording('missing-session');

      expect(fs.existsSync).toHaveBeenCalledWith('/mock/home/.seth/recordings/missing-session.jsonl');
      expect(result).toEqual([]);
    });

    it('reads and parses valid JSONL records', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const record1 = { timestamp: '2024-01-01', sessionId: 's-1', role: 'user', content: 'hello' };
      const record2 = { timestamp: '2024-01-01', sessionId: 's-1', role: 'assistant', content: 'hi' };

      const mockFileContent = `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n`;
      vi.mocked(fs.readFileSync).mockReturnValue(mockFileContent);

      const result = readRecording('s-1');

      expect(fs.readFileSync).toHaveBeenCalledWith('/mock/home/.seth/recordings/s-1.jsonl', 'utf-8');
      expect(result).toEqual([record1, record2]);
    });

    it('returns empty array when readFileSync throws', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = readRecording('error-session');

      expect(result).toEqual([]);
    });
  });
});
