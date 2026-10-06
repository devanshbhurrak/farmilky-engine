import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  CollectionTotalQuery,
  OutstandingQuery,
  RecordSupplierPaymentInput,
  SupplierHistoryParam,
  SupplierHistoryQuery,
} from './supplierPayment.schema.js';
import {
  getCollectionTotal,
  getOutstanding,
  getSupplierPaymentHistory,
  recordSupplierPayment,
} from './supplierPayment.service.js';

export const outstandingController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as OutstandingQuery;
  const result = await getOutstanding(user.tenantId, query);
  return ok(c, result);
};

export const collectionTotalController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as CollectionTotalQuery;
  const result = await getCollectionTotal(user.tenantId, query);
  return ok(c, result);
};

export const recordSupplierPaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as RecordSupplierPaymentInput;
  const result = await recordSupplierPayment(user.tenantId, body, user.id);
  return created(c, result);
};

export const supplierPaymentHistoryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierHistoryParam;
  const query = (c.get('query') ?? {}) as SupplierHistoryQuery;
  const { rows, meta, supplier } = await getSupplierPaymentHistory(user.tenantId, params.supplierId, query);
  return paginated(c, { payments: rows, supplier }, meta);
};
