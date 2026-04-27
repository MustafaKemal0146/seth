import { describe, it, expect } from 'vitest';
import { detectOmissionPlaceholder } from '../src/omission-detector';

describe('detectOmissionPlaceholder', () => {
  it('should return true for basic ellipsis patterns on a single line', () => {
    expect(detectOmissionPlaceholder('...')).toBe(true);
    expect(detectOmissionPlaceholder('   ...   ')).toBe(true);
    expect(detectOmissionPlaceholder('.....')).toBe(true);
  });

  it('should return true for commented ellipsis patterns', () => {
    expect(detectOmissionPlaceholder('// ...')).toBe(true);
    expect(detectOmissionPlaceholder('# ...')).toBe(true);
    expect(detectOmissionPlaceholder('/* ... */')).toBe(true);
    expect(detectOmissionPlaceholder('   // ...   ')).toBe(true);
  });

  it('should return true for bracketed and parenthesized ellipsis patterns', () => {
    expect(detectOmissionPlaceholder('[...]')).toBe(true);
    expect(detectOmissionPlaceholder('(...)')).toBe(true);
    expect(detectOmissionPlaceholder('[  ...  ]')).toBe(true);
    expect(detectOmissionPlaceholder('(  ...  )')).toBe(true);
  });

  it('should return true for TODO omit patterns', () => {
    expect(detectOmissionPlaceholder('// TODO: omit this part')).toBe(true);
    expect(detectOmissionPlaceholder('// todo omit')).toBe(true);
    expect(detectOmissionPlaceholder('// TODO - omit the rest')).toBe(true);
  });

  it('should return true for "rest of" patterns in comments', () => {
    expect(detectOmissionPlaceholder('// rest of the code')).toBe(true);
    expect(detectOmissionPlaceholder('# rest of the file')).toBe(true);
    expect(detectOmissionPlaceholder('// REST OF THE METHOD')).toBe(true);
  });

  it('should return true for exact and startsWith matches of omitted prefixes', () => {
    const prefixes = [
      'rest of',
      'rest of method',
      'rest of code',
      'unchanged code',
      'unchanged method',
      'existing code',
      'previous code',
      'kalan kod',
      'geri kalan',
      'değişmeyen kod',
    ];

    for (const prefix of prefixes) {
      // Exact match
      expect(detectOmissionPlaceholder(prefix)).toBe(true);
      // Prefixed match
      expect(detectOmissionPlaceholder(`${prefix} is skipped here`)).toBe(true);
      // With spaces
      expect(detectOmissionPlaceholder(`   ${prefix}   `)).toBe(true);
      // Case insensitive
      expect(detectOmissionPlaceholder(prefix.toUpperCase())).toBe(true);
    }
  });

  it('should return false for regular code and normal text', () => {
    expect(detectOmissionPlaceholder('const x = 5;')).toBe(false);
    expect(detectOmissionPlaceholder('function test() { return "..."; }')).toBe(false);
    expect(detectOmissionPlaceholder('This is just a regular text.')).toBe(false);
    expect(detectOmissionPlaceholder('// This is a regular comment')).toBe(false);
    expect(detectOmissionPlaceholder('// To do: fix this bug')).toBe(false); // Does not contain omit
  });

  it('should return false if ellipsis is not alone on the line', () => {
    expect(detectOmissionPlaceholder('...wait, what?')).toBe(false);
    expect(detectOmissionPlaceholder('const a = [1, 2, ...rest];')).toBe(false);
  });

  it('should return false if text contains a prefix but does not start with it', () => {
    expect(detectOmissionPlaceholder('Here is the rest of the code')).toBe(false);
    expect(detectOmissionPlaceholder('This uses the unchanged code')).toBe(false);
  });

  it('should correctly detect omissions across multiple lines', () => {
    const multiLineCode = `
function someMethod() {
  const x = 1;
  // ...
  return x;
}
    `;
    expect(detectOmissionPlaceholder(multiLineCode)).toBe(true);

    const multiLineWithPrefix = `
function anotherMethod() {
  // Here we go
  unchanged code below
}
    `;
    expect(detectOmissionPlaceholder(multiLineWithPrefix)).toBe(true);
  });

  it('should return false for multi-line code without any omissions', () => {
    const regularMultiLineCode = `
function sum(a, b) {
  return a + b;
}
    `;
    expect(detectOmissionPlaceholder(regularMultiLineCode)).toBe(false);
  });
});
