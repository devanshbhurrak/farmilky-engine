import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  DeletePaymentInput,
  LedgerQuery,
  PassbookQuery,
  PaymentIdParam,
  PaymentUserParam,
  RecordPaymentInput,
  UpdatePaymentInput,
} from './payment.schema.js';
import {
  deletePayment,
  getCustomerLedger,
  getPassbook,
  reconcilePayment,
  recordPayment,
  updatePayment,
} from './payment.service.js';

export const myPassbookController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as PassbookQuery;
  const { rows, meta } = await getPassbook(user.tenantId, user.id, query);
  return paginated(c, rows, meta);
};

export const userPassbookController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as PaymentUserParam;
  const query = (c.get('query') ?? {}) as PassbookQuery;
  const { rows, meta } = await getPassbook(user.tenantId, params.userId, query);
  return paginated(c, rows, meta);
};

export const userLedgerController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as PaymentUserParam;
  const query = (c.get('query') ?? {}) as LedgerQuery;
  const ledger = await getCustomerLedger(user.tenantId, params.userId, query);
  return ok(c, ledger);
};

export const recordPaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as RecordPaymentInput;
  const txn = await recordPayment(user.tenantId, body, user.id);
  return created(c, txn);
};

export const updatePaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as PaymentIdParam;
  const body = c.get('body') as UpdatePaymentInput;
  const updated = await updatePayment(params.id, user.tenantId, body, user.id);
  return ok(c, updated);
};

export const reconcilePaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as PaymentIdParam;
  const result = await reconcilePayment(params.id, user.tenantId, user.id);
  return ok(c, result);
};

export const deletePaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as PaymentIdParam;
  const body = c.get('body') as DeletePaymentInput;
  const result = await deletePayment(params.id, user.tenantId, body, user.id);
  return ok(c, result);
};
