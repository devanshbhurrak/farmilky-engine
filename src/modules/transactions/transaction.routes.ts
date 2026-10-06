import { Hono } from 'hono';
import type { HonoEnv } from '../../shared/types/index.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { validateBody, validateParams } from '../../shared/middleware/validate.js';
import { TransactionController } from './transaction.controller.js';
import { editTxnSchema, txnIdParamSchema, voidTxnSchema } from './transaction.schema.js';

export const transactionRoutes = new Hono<HonoEnv>();

transactionRoutes.use('*', auth, tenant, adminOnly);

transactionRoutes.put('/:id', validateParams(txnIdParamSchema), validateBody(editTxnSchema), TransactionController.edit);
transactionRoutes.delete('/:id', validateParams(txnIdParamSchema), validateBody(voidTxnSchema), TransactionController.remove);
transactionRoutes.post('/:id/void', validateParams(txnIdParamSchema), validateBody(voidTxnSchema), TransactionController.void);
