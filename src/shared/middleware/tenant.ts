import { createMiddleware } from 'hono/factory';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { HonoEnv } from '../types/index.js';

// Publishes the request's tenant to Postgres for Row-Level Security.
//
// Design notes (read before "simplifying"):
// - The pooled postgres.js driver may serve consecutive queries in one
//   request from DIFFERENT connections, so this session variable is only a
//   best-effort safety net. The primary enforcement is the explicit
//   `tenant_id` predicate every repository adds to every query.
// - RLS is additionally only enforced for non-table-owner roles; when the app
//   connects as the table owner, policies are bypassed and the explicit
//   predicates are the entire enforcement. For RLS to be real, run the app
//   with a least-privilege role + FORCE ROW LEVEL SECURITY.
// - We use session scope (is_local=false) because SET LOCAL is a no-op outside
//   a transaction, and always RESET in a finally block so a pooled connection
//   never leaks one tenant's context into the next request.
// Must run AFTER `auth` middleware.
export const tenant = createMiddleware<HonoEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user?.tenantId) {
    return c.json({ success: false, message: 'Tenant context missing' }, 400);
  }
  await db.execute(sql`SELECT set_config('app.tenant_id', ${user.tenantId}, false)`);
  try {
    await next();
  } finally {
    await db.execute(sql`SELECT set_config('app.tenant_id', '', false)`).catch(() => undefined);
  }
});
