import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  CreateExpenseInput,
  DeleteExpenseInput,
  ExpenseIdParam,
  ExpenseQuery,
  ExpenseSummaryQuery,
  UpdateExpenseInput,
} from './expense.schema.js';
import { createExpense, expenseSummary, listExpenses, removeExpense, updateExpense } from './expense.service.js';

export const listExpensesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ExpenseQuery;
  const { rows, meta } = await listExpenses(user.tenantId, query);
  return paginated(c, rows, meta);
};

export const expenseSummaryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ExpenseSummaryQuery;
  const summary = await expenseSummary(user.tenantId, query);
  return ok(c, summary);
};

export const createExpenseController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateExpenseInput;
  const expense = await createExpense(user.tenantId, body, user.id);
  return created(c, expense);
};

export const updateExpenseController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ExpenseIdParam;
  const body = c.get('body') as UpdateExpenseInput;
  const updated = await updateExpense(params.id, user.tenantId, body, user.id);
  return ok(c, updated);
};

export const deleteExpenseController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ExpenseIdParam;
  const body = c.get('body') as DeleteExpenseInput;
  const result = await removeExpense(params.id, user.tenantId, body, user.id);
  return ok(c, result);
};
