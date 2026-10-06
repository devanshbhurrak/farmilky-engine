import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  AdjustmentInput,
  CreateSupplierInput,
  DeleteAdjustmentInput,
  StatusInput,
  SupplierAdjustmentParam,
  SupplierIdParam,
  SupplierListQuery,
  SupplierPassbookQuery,
  UpdateSupplierInput,
} from './supplier.schema.js';
import {
  createSupplier,
  createSupplierAdjustment,
  deleteSupplier,
  deleteSupplierAdjustment,
  getSupplier,
  getSupplierPassbook,
  listSuppliersService,
  setSupplierStatus,
  updateSupplier,
} from './supplier.service.js';

export const listSuppliersController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as SupplierListQuery;
  const { rows, meta } = await listSuppliersService(user.tenantId, query);
  return paginated(c, rows, meta);
};

export const createSupplierController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateSupplierInput;
  const supplier = await createSupplier(user.tenantId, body, user.id);
  return created(c, supplier);
};

export const getSupplierController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const supplier = await getSupplier(user.tenantId, params.id);
  return ok(c, supplier);
};

export const updateSupplierController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const body = c.get('body') as UpdateSupplierInput;
  const supplier = await updateSupplier(user.tenantId, params.id, body, user.id);
  return ok(c, supplier);
};

export const deleteSupplierController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const supplier = await deleteSupplier(user.tenantId, params.id, user.id);
  return ok(c, supplier);
};

export const setSupplierStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const body = c.get('body') as StatusInput;
  const result = await setSupplierStatus(user.tenantId, params.id, body.isActive, user.id);
  return ok(c, result);
};

export const getSupplierPassbookController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const query = (c.get('query') ?? {}) as SupplierPassbookQuery;
  const { rows, meta } = await getSupplierPassbook(user.tenantId, params.id, query);
  return paginated(c, rows, meta);
};

export const createAdjustmentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierIdParam;
  const body = c.get('body') as AdjustmentInput;
  const txn = await createSupplierAdjustment(user.tenantId, params.id, body, user.id);
  return created(c, txn);
};

export const deleteAdjustmentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SupplierAdjustmentParam;
  const body = c.get('body') as DeleteAdjustmentInput;
  const result = await deleteSupplierAdjustment(user.tenantId, params.id, params.adjId, body.void_reason, user.id);
  return ok(c, result);
};
