import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createProductController,
  deleteProductController,
  getProductController,
  listProductsController,
  updateProductController,
} from './product.controller.js';
import {
  createProductSchema,
  productIdParamSchema,
  productListQuerySchema,
  updateProductSchema,
} from './product.schema.js';

export const productRoutes = new Hono<HonoEnv>();

productRoutes.get('/', validateQuery(productListQuerySchema), listProductsController);
productRoutes.get('/:id', validateParams(productIdParamSchema), getProductController);

productRoutes.post('/', auth, tenant, adminOnly, validateBody(createProductSchema), createProductController);
productRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  updateProductController,
);
productRoutes.delete(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(productIdParamSchema),
  deleteProductController,
);
