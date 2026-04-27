import { describe, it, expect } from 'vitest';
import { formatCostUSD } from '../src/model-cost.js';

describe('formatCostUSD', () => {
  it('should format exact zero as < $0.0001', () => {
    expect(formatCostUSD(0)).toBe('< $0.0001');
  });

  it('should format negative values as < $0.0001', () => {
    expect(formatCostUSD(-1)).toBe('< $0.0001');
    expect(formatCostUSD(-0.5)).toBe('< $0.0001');
    expect(formatCostUSD(-0.00005)).toBe('< $0.0001');
  });

  it('should format values less than 0.0001 as < $0.0001', () => {
    expect(formatCostUSD(0.00009)).toBe('< $0.0001');
    expect(formatCostUSD(0.00005)).toBe('< $0.0001');
    expect(formatCostUSD(0.00001)).toBe('< $0.0001');
  });

  it('should format values greater than or equal to 0.0001 to 4 decimal places', () => {
    expect(formatCostUSD(0.0001)).toBe('0.0001');
    expect(formatCostUSD(0.00015)).toBe('0.0001');
    expect(formatCostUSD(0.00016)).toBe('0.0002');
    expect(formatCostUSD(0.005)).toBe('0.0050');
    expect(formatCostUSD(0.5)).toBe('0.5000');
    expect(formatCostUSD(1)).toBe('1.0000');
    expect(formatCostUSD(1.2345)).toBe('1.2345');
    expect(formatCostUSD(1.23456)).toBe('1.2346');
  });
});
