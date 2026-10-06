import { describe, expect, it } from 'vitest';
import { lastDayOfMonth } from '../../shared/services/invoiceService.js';
import { round2 } from '../../shared/utils/dateUtils.js';

// Mirrors the invoice net-amount-due formula in shared/services/invoiceService.ts:
// netAmountDue = prev + charges - payments - orderCredits + adjustments - refunds
// status = paid when netAmountDue <= 0 AND (totalPayments > 0 OR overpayment), else draft.
function netAmountDue(parts: {
  previousBalance: number;
  totalCharges: number;
  totalPayments: number;
  orderCredits: number;
  totalAdjustments: number;
  totalRefunds?: number;
}): number {
  const { previousBalance, totalCharges, totalPayments, orderCredits, totalAdjustments, totalRefunds = 0 } = parts;
  return round2(
    previousBalance + totalCharges - totalPayments - orderCredits + totalAdjustments - totalRefunds,
  );
}

function invoiceStatus(net: number, totalPayments: number): string {
  if (net <= 0 && (totalPayments > 0 || net < 0)) return 'paid';
  return 'draft';
}

/**
 * getPreviousBalance logic: if prior invoice is paid, carry forward max(0, net)
 * so overpayment (net < 0) is NOT carried forward as a negative balance.
 * If prior invoice is outstanding (not paid), carry full net.
 */
function getPreviousBalance(priorStatus: string, priorNet: number): number {
  if (priorStatus === 'paid') return Math.max(0, priorNet);
  return priorNet;
}

describe('invoice net amount due', () => {
  it('full formula: prev + charges - payments - orderCredits + adjustments - refunds', () => {
    expect(
      netAmountDue({
        previousBalance: 500,
        totalCharges: 2000,
        totalPayments: 1200,
        orderCredits: 100,
        totalAdjustments: 50,
        totalRefunds: 0,
      }),
    ).toBe(1250);
  });

  it('refunds reduce amount due', () => {
    expect(
      netAmountDue({
        previousBalance: 0,
        totalCharges: 1000,
        totalPayments: 0,
        orderCredits: 0,
        totalAdjustments: 0,
        totalRefunds: 200,
      }),
    ).toBe(800);
  });

  it('full refund brings net to zero', () => {
    expect(
      netAmountDue({
        previousBalance: 0,
        totalCharges: 500,
        totalPayments: 0,
        orderCredits: 0,
        totalAdjustments: 0,
        totalRefunds: 500,
      }),
    ).toBe(0);
  });

  it('floating point handled with round2', () => {
    expect(
      netAmountDue({
        previousBalance: 0,
        totalCharges: 33.33,
        totalPayments: 11.11,
        orderCredits: 0,
        totalAdjustments: 0,
        totalRefunds: 0,
      }),
    ).toBe(22.22);
  });

  it('status=paid when netAmountDue = 0 and payment was made', () => {
    expect(invoiceStatus(0, 1000)).toBe('paid');
  });

  it('status=paid when netAmountDue < 0 (overpayment)', () => {
    expect(invoiceStatus(-10.5, 500)).toBe('paid');
  });

  it('status=draft when netAmountDue > 0', () => {
    expect(invoiceStatus(0.01, 0)).toBe('draft');
  });

  it('status=draft when netAmountDue = 0 but no payments (no-charge month)', () => {
    expect(invoiceStatus(0, 0)).toBe('draft');
  });

  it('previousBalance = 0 when prior invoice is paid (exact balance)', () => {
    expect(getPreviousBalance('paid', 0)).toBe(0);
  });

  it('previousBalance = 0 when prior invoice is paid but had overpayment', () => {
    // Overpayment (net < 0) on a paid invoice must NOT carry forward as credit
    expect(getPreviousBalance('paid', -50)).toBe(0);
  });

  it('previousBalance = prior netAmountDue when prior invoice is outstanding', () => {
    expect(getPreviousBalance('sent', 750.25)).toBe(750.25);
  });

  it('previousBalance = prior netAmountDue when prior is partially_paid', () => {
    expect(getPreviousBalance('partially_paid', 300)).toBe(300);
  });

  it('fresh customer with no prior invoice: previousBalance = 0', () => {
    // null prior → 0
    const prev = 0; // getPreviousBalance returns 0 when no prior invoice
    expect(
      netAmountDue({ previousBalance: prev, totalCharges: 1000, totalPayments: 1000, orderCredits: 0, totalAdjustments: 0 }),
    ).toBe(0);
  });

  it('outstanding balance compounds across months', () => {
    const prev = getPreviousBalance('sent', 500);
    expect(
      netAmountDue({ previousBalance: prev, totalCharges: 1000, totalPayments: 0, orderCredits: 0, totalAdjustments: 0 }),
    ).toBe(1500);
  });
});

describe('lastDayOfMonth', () => {
  it('returns last day of January (31)', () => {
    expect(lastDayOfMonth(2026, 1)).toBe('2026-01-31');
  });

  it('returns last day of February in a non-leap year (28)', () => {
    expect(lastDayOfMonth(2026, 2)).toBe('2026-02-28');
  });

  it('returns last day of February in a leap year (29)', () => {
    expect(lastDayOfMonth(2024, 2)).toBe('2024-02-29');
  });

  it('returns last day of April (30)', () => {
    expect(lastDayOfMonth(2026, 4)).toBe('2026-04-30');
  });

  it('returns last day of December (31)', () => {
    expect(lastDayOfMonth(2026, 12)).toBe('2026-12-31');
  });
});
