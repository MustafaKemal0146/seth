import { describe, it, expect } from 'vitest';
import { truncatePathMiddle } from '../src/truncate.js';

describe('truncatePathMiddle', () => {
  it('should return the original path if it is within maxLength', () => {
    const path = 'src/index.ts';
    expect(truncatePathMiddle(path, 20)).toBe(path);
    expect(truncatePathMiddle(path, path.length)).toBe(path);
  });

  it('should truncate middle for long POSIX paths', () => {
    const path = 'very/long/path/to/some/deeply/nested/file/Component.tsx';
    const maxLength = 30;
    const result = truncatePathMiddle(path, maxLength);

    expect(result.length).toBeLessThanOrEqual(maxLength);
    expect(result).toContain('…');
    expect(result).toContain('Component.tsx');
    expect(result.startsWith('very/')).toBe(true);
    expect(result).toBe('very/long/path/…/Component.tsx');
    // filename: Component.tsx (13 chars)
    // available: 30 - 13 - 3 = 14
    // very/long/path (14) <= 14. prefix = very/long/path
    // very/long/path/to (17) > 14. break.
    // Result: very/long/path/…/Component.tsx (14+1+1+1+13 = 30)
  });

  it('should truncate middle for long Windows paths', () => {
    const path = 'C:\\Users\\Admin\\Documents\\Projects\\Seth\\src\\main.ts';
    const maxLength = 30;
    const result = truncatePathMiddle(path, maxLength);

    expect(result.length).toBeLessThanOrEqual(maxLength);
    expect(result).toContain('…');
    expect(result).toContain('main.ts');
    expect(result).toContain('\\');
    expect(result).not.toContain('/');
    expect(result).toBe('C:\\Users\\Admin\\…\\main.ts');
  });

  it('should handle long filenames by truncating the filename itself', () => {
    const path = 'some/dir/this-is-a-very-long-filename-that-exceeds-max-length.ts';
    const maxLength = 20;
    const result = truncatePathMiddle(path, maxLength);

    expect(result.length).toBe(maxLength);
    expect(result.startsWith('…')).toBe(true);
    expect(result).toBe('…ceeds-max-length.ts');
  });

  it('should handle paths with no separators', () => {
    const path = 'LongFileNameWithoutAnySeparatorsInIt.extension';
    const maxLength = 10;
    const result = truncatePathMiddle(path, maxLength);

    expect(result.length).toBe(maxLength);
    expect(result).toBe('…extension');
  });

  it('should handle very small maxLength', () => {
    const path = 'a/b/c.txt';
    expect(truncatePathMiddle(path, 5)).toBe('….txt');
    expect(truncatePathMiddle(path, 1)).toBe('…');
    expect(truncatePathMiddle(path, 2)).toBe('…t');
  });

  it('should handle empty string', () => {
    expect(truncatePathMiddle('', 10)).toBe('');
  });

  it('should handle paths ending with separator', () => {
     const path = 'some/deep/path/';
     const maxLength = 10;
     const result = truncatePathMiddle(path, maxLength);
     expect(result).toBe('some/…/');
  });
});
