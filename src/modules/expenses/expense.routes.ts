import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createExpenseController,
  deleteExpenseController,
  expenseSummaryController,
  listExpensesController,
  updateExpenseController,
} from './expense.controller.js';
import {
  createExpenseSchema,
  deleteExpenseSchema,
  expenseIdParamSchema,
  expenseQuerySchema,
  expenseSummaryQuerySchema,
  updateExpenseSchema,
} from './expense.schema.js';

export const expenseRoutes = new Hono<HonoEnv>();

expenseRoutes.get(
  '/summary',
  auth,
  tenant,
  adminOnly,
  validateQuery(expenseSummaryQuerySchema),
  expenseSummaryController,
);
expenseRoutes.get('/', auth, tenant, adminOnly, validateQuery(expenseQuerySchema), listExpensesController);
expenseRoutes.post(
  '/',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateBody(createExpenseSchema),
  createExpenseController,
);
expenseRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateParams(expenseIdParamSchema),
  validateBody(updateExpenseSchema),
  updateExpenseController,
);
expenseRoutes.delete(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(expenseIdParamSchema),
  validateBody(deleteExpenseSchema),
  deleteExpenseController,
);
