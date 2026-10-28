import { describe, expect, it } from 'vitest';
import { createExpenseSchema, updateExpenseSchema } from '../../modules/expenses/expense.schema.js';

describe('expense validation', () => {
  it('accepts a receipt reference and trims surrounding whitespace', () => {
    const result = createExpenseSchema.safeParse({
      amount: 125,
      category: 'packaging',
      date: '2026-02-14',
      description: 'Packaging supplies',
      receiptReference: '  BILL-42  ',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.receiptReference).toBe('BILL-42');
  });

  it('rejects receipt references that exceed the supported length', () => {
    const result = updateExpenseSchema.safeParse({
      receiptReference: 'R'.repeat(201),
    });

    expect(result.success).toBe(false);
  });
});
