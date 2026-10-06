import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { HonoEnv } from '../../shared/types/index.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { sseManager } from '../../shared/realtime/sseManager.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';

export const sseRoutes = new Hono<HonoEnv>();

// Agent live manifest feed. The client subscribes with ?areaId=&slot= to
// receive entry updates for that manifest; a personal channel is always
// subscribed as well. Events: entry_updated, manifest_completed.
sseRoutes.get('/manifest', auth, tenant, requirePermission('manifest.view_today'), (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);
  const areaId = url.searchParams.get('areaId') ?? undefined;
  const slot = url.searchParams.get('slot') ?? undefined;
  const date = url.searchParams.get('date') ?? toDateOnlyString(istToday());

  const personalKey = `${user.tenantId}:${user.id}:${date}`;
  const manifestKey =
    areaId && slot ? `${user.tenantId}:${areaId}:${date}:${slot}` : undefined;

  return streamSSE(c, async (stream) => {
    const ssStream = {
      send: (event: string, data: unknown) => {
        void stream.writeSSE({ data: String(data), event });
      },
    };
    sseManager.subscribe(personalKey, ssStream);
    if (manifestKey) sseManager.subscribe(manifestKey, ssStream);
    stream.onAbort(() => {
      sseManager.unsubscribe(personalKey, ssStream);
      if (manifestKey) sseManager.unsubscribe(manifestKey, ssStream);
    });
    // Keep the connection alive for 30 minutes
    await stream.sleep(30 * 60 * 1000);
  });
});
