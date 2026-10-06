import type { Context } from 'hono';
import { transactionService } from './transaction.service.js';
import { ok } from '../../shared/utils/response.js';

export const TransactionController = {
  async void(c: Context) {
    const user = c.get('user');
    const { id } = c.get('params') as { id: string };
    const body = c.get('body') as { void_reason: string };
    const reversal = await transactionService.voidTransaction(id, user.tenantId, body.void_reason, user.id);
    return ok(c, reversal);
  },

  async edit(c: Context) {
    const user = c.get('user');
    const { id } = c.get('params') as { id: string };
    const body = c.get('body') as Record<string, unknown> & { void_reason: string };
    const { void_reason, ...rest } = body;
    const corrected = await transactionService.editTransaction(id, user.tenantId, rest, void_reason, user.id);
    return ok(c, corrected);
  },

  async remove(c: Context) {
    const user = c.get('user');
    const { id } = c.get('params') as { id: string };
    const body = c.get('body') as { void_reason: string };
    const reversal = await transactionService.deleteTransaction(id, user.tenantId, body.void_reason, user.id);
    return ok(c, reversal);
  },
};
