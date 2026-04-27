import { describe, it, expect } from 'vitest';
import { classifyTool, shouldAutoApprove } from '../src/permission-classifier.js';

describe('permission-classifier', () => {
  describe('classifyTool', () => {
    it('should return "safe" for always safe tools', () => {
      expect(classifyTool('file_read', {})).toBe('safe');
      expect(classifyTool('search', {})).toBe('safe');
      expect(classifyTool('grep', {})).toBe('safe');
    });

    describe('shell_execute & bash', () => {
      it('should return "deny" for explicitly denied patterns', () => {
        expect(classifyTool('shell_execute', { command: 'rm -rf /' })).toBe('deny');
        expect(classifyTool('bash', { command: 'rm -rf *' })).toBe('deny');
        expect(classifyTool('shell_execute', { cmd: 'sudo rm file.txt' })).toBe('deny');
        expect(classifyTool('shell_execute', { command: ':(){ :|:& };:' })).toBe('deny');
        expect(classifyTool('bash', { command: 'dd if=/dev/zero of=/dev/sda' })).toBe('deny');
        expect(classifyTool('shell_execute', { cmd: 'mkfs.ext4 /dev/sda1' })).toBe('deny');
        expect(classifyTool('shell_execute', { command: 'echo hello > /dev/sda' })).toBe('deny');
      });

      it('should return "confirm" for dangerous commands', () => {
        expect(classifyTool('shell_execute', { command: 'rm file.txt' })).toBe('confirm');
        expect(classifyTool('bash', { cmd: 'mv a b' })).toBe('confirm');
        expect(classifyTool('shell_execute', { command: 'chmod 777 file' })).toBe('confirm');
        expect(classifyTool('shell_execute', { command: 'npm install' })).toBe('confirm');
        expect(classifyTool('bash', { cmd: 'curl http://example.com' })).toBe('confirm');
        expect(classifyTool('shell_execute', { command: 'systemctl restart nginx' })).toBe('confirm');
        expect(classifyTool('bash', { command: 'kill 9999' })).toBe('confirm');
      });

      it('should return "safe" for safe shell prefixes', () => {
        expect(classifyTool('shell_execute', { command: 'cat file.txt' })).toBe('safe');
        expect(classifyTool('bash', { cmd: 'ls -la' })).toBe('safe');
        expect(classifyTool('shell_execute', { command: 'pwd' })).toBe('safe');
        expect(classifyTool('bash', { command: 'git status' })).toBe('safe');
        expect(classifyTool('shell_execute', { command: 'npm list' })).toBe('safe');
        expect(classifyTool('bash', { cmd: 'node --version' })).toBe('safe');
        expect(classifyTool('shell_execute', { command: 'echo "hello"' })).toBe('safe');
      });

      it('should default to "confirm" for unknown commands', () => {
        expect(classifyTool('shell_execute', { command: 'my_custom_command' })).toBe('confirm');
        expect(classifyTool('bash', { cmd: 'docker run ubuntu' })).toBe('confirm');
      });
    });

    describe('file_write & file_edit', () => {
      it('should return "safe" for safe file extensions', () => {
        expect(classifyTool('file_write', { path: 'README.md' })).toBe('safe');
        expect(classifyTool('file_edit', { path: 'config.json' })).toBe('safe');
        expect(classifyTool('file_write', { path: 'data.yaml' })).toBe('safe');
        expect(classifyTool('file_edit', { path: '.env.example' })).toBe('safe');
        expect(classifyTool('file_write', { path: '.gitignore' })).toBe('safe');
      });

      it('should return "confirm" for potentially unsafe extensions (source code)', () => {
        expect(classifyTool('file_write', { path: 'index.ts' })).toBe('confirm');
        expect(classifyTool('file_edit', { path: 'app.js' })).toBe('confirm');
        expect(classifyTool('file_write', { path: 'script.sh' })).toBe('confirm');
        expect(classifyTool('file_edit', { path: 'main.py' })).toBe('confirm');
      });

      it('should return "confirm" if no path is provided', () => {
        expect(classifyTool('file_write', {})).toBe('confirm');
      });
    });

    it('should return "confirm" for agent_spawn', () => {
      expect(classifyTool('agent_spawn', {})).toBe('confirm');
    });

    it('should return "confirm" for unknown tools', () => {
      expect(classifyTool('unknown_tool', {})).toBe('confirm');
      expect(classifyTool('custom_plugin_tool', {})).toBe('confirm');
    });
  });

  describe('shouldAutoApprove', () => {
    it('should return true if permissionLevel is "full"', () => {
      expect(shouldAutoApprove('shell_execute', { command: 'rm -rf /' }, 'full')).toBe(true);
      expect(shouldAutoApprove('file_write', { path: 'index.ts' }, 'full')).toBe(true);
    });

    it('should return true if permissionLevel is NOT "full" but tool is classified as "safe"', () => {
      expect(shouldAutoApprove('file_read', {}, 'restricted')).toBe(true);
      expect(shouldAutoApprove('shell_execute', { command: 'ls' }, 'auto')).toBe(true);
      expect(shouldAutoApprove('file_write', { path: 'test.md' }, 'read-only')).toBe(true);
    });

    it('should return false if permissionLevel is NOT "full" and tool is NOT classified as "safe"', () => {
      expect(shouldAutoApprove('shell_execute', { command: 'rm file.txt' }, 'restricted')).toBe(false);
      expect(shouldAutoApprove('file_write', { path: 'index.ts' }, 'auto')).toBe(false);
      expect(shouldAutoApprove('unknown_tool', {}, 'read-only')).toBe(false);
    });
  });
});
