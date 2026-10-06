import { describe, expect, it } from 'vitest';
import { computeDelta, flipEntry } from '../../modules/transactions/transaction.service.js';

describe('computeDelta', () => {
  it('customer debit = positive delta (balance increases — customer owes more)', () => {
    expect(computeDelta('customer', 'debit', 100)).toBe(100);
  });

  it('customer credit = negative delta (balance decreases — customer paid)', () => {
    expect(computeDelta('customer', 'credit', 100)).toBe(-100);
  });

  it('supplier credit = positive delta (we owe supplier more)', () => {
    expect(computeDelta('supplier', 'credit', 250.5)).toBe(250.5);
  });

  it('supplier debit = negative delta (supplier owes us or we paid them)', () => {
    expect(computeDelta('supplier', 'debit', 250.5)).toBe(-250.5);
  });

  it('business party = 0 (no balance party to update)', () => {
    expect(computeDelta('business', 'debit', 999)).toBe(0);
    expect(computeDelta('business', 'credit', 999)).toBe(0);
  });

  it('unknown party type = 0 (defensive fallback)', () => {
    expect(computeDelta('unknown', 'debit', 100)).toBe(0);
  });

  it('fractional amounts are preserved precisely', () => {
    expect(computeDelta('customer', 'debit', 33.33)).toBe(33.33);
    expect(computeDelta('supplier', 'credit', 0.01)).toBe(0.01);
  });

  it('zero amount gives zero delta', () => {
    expect(computeDelta('customer', 'debit', 0)).toBe(0);
    expect(computeDelta('supplier', 'credit', 0)).toBe(0);
  });

  it('large amounts do not overflow', () => {
    expect(computeDelta('customer', 'debit', 999999.99)).toBe(999999.99);
  });
});

describe('flipEntry', () => {
  it('flips debit to credit', () => {
    expect(flipEntry('debit')).toBe('credit');
  });

  it('flips credit to debit', () => {
    expect(flipEntry('credit')).toBe('debit');
  });

  it('roundtrip: flip twice returns original', () => {
    expect(flipEntry(flipEntry('debit'))).toBe('debit');
    expect(flipEntry(flipEntry('credit'))).toBe('credit');
  });
});
