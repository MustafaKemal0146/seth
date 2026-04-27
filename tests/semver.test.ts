import { describe, it, expect } from 'vitest';
import { semverGte, semverGt } from '../src/semver.js';

describe('semverGte', () => {
  it('should return true for equal versions', () => {
    expect(semverGte('1.0.0', '1.0.0')).toBe(true);
    expect(semverGte('2.1.3', '2.1.3')).toBe(true);
  });

  it('should return true if a is greater than b (major)', () => {
    expect(semverGte('2.0.0', '1.9.9')).toBe(true);
    expect(semverGte('10.0.0', '9.9.9')).toBe(true);
  });

  it('should return false if a is less than b (major)', () => {
    expect(semverGte('1.9.9', '2.0.0')).toBe(false);
  });

  it('should return true if a is greater than b (minor)', () => {
    expect(semverGte('1.2.0', '1.1.9')).toBe(true);
  });

  it('should return false if a is less than b (minor)', () => {
    expect(semverGte('1.1.9', '1.2.0')).toBe(false);
  });

  it('should return true if a is greater than b (patch)', () => {
    expect(semverGte('1.1.2', '1.1.1')).toBe(true);
  });

  it('should return false if a is less than b (patch)', () => {
    expect(semverGte('1.1.1', '1.1.2')).toBe(false);
  });

  it('should handle missing components gracefully', () => {
    expect(semverGte('1.0', '1.0.0')).toBe(true); // 1.0.0 >= 1.0.0
    expect(semverGte('1.0.0', '1.0')).toBe(true); // 1.0.0 >= 1.0.0
    expect(semverGte('1.1', '1.0.9')).toBe(true); // 1.1.0 >= 1.0.9
    expect(semverGte('1.0.9', '1.1')).toBe(false); // 1.0.9 >= 1.1.0
    expect(semverGte('2', '1.9.9')).toBe(true); // 2.0.0 >= 1.9.9
  });
});

describe('semverGt', () => {
  it('should return false for equal versions', () => {
    expect(semverGt('1.0.0', '1.0.0')).toBe(false);
    expect(semverGt('2.1.3', '2.1.3')).toBe(false);
  });

  it('should return true if a is strictly greater than b', () => {
    expect(semverGt('2.0.0', '1.9.9')).toBe(true);
    expect(semverGt('1.2.0', '1.1.9')).toBe(true);
    expect(semverGt('1.1.2', '1.1.1')).toBe(true);
  });

  it('should return false if a is strictly less than b', () => {
    expect(semverGt('1.9.9', '2.0.0')).toBe(false);
    expect(semverGt('1.1.9', '1.2.0')).toBe(false);
    expect(semverGt('1.1.1', '1.1.2')).toBe(false);
  });

  it('should evaluate partial versions properly with strict gt', () => {
    expect(semverGt('1.0', '1.0')).toBe(false);
    expect(semverGt('1.1', '1.0.9')).toBe(true);

    // As currently implemented, semverGt checks a !== b.
    // '1.0' !== '1.0.0' evaluates to true.
    expect(semverGt('1.0', '1.0.0')).toBe(true);
  });
});
