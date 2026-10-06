import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok } from '../../shared/utils/response.js';
import type { AddItemInput, RemoveParams, RemoveQuery, UpdateItemInput } from './cart.schema.js';
import { addItem, clearCart, getCart, removeItem, updateItem } from './cart.service.js';

export const getCartController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const view = await getCart(user.tenantId, user.id);
  return ok(c, view);
};

export const addItemController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as AddItemInput;
  const view = await addItem(user.tenantId, user.id, body);
  return created(c, view);
};

export const updateItemController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as UpdateItemInput;
  const view = await updateItem(user.tenantId, user.id, body);
  return ok(c, view);
};

export const removeItemController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as RemoveParams;
  const query = (c.get('query') ?? {}) as RemoveQuery;
  const view = await removeItem(user.tenantId, user.id, params.productId, query.variantId ?? null);
  return ok(c, view);
};

export const clearCartController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const view = await clearCart(user.tenantId, user.id);
  return ok(c, view);
};
