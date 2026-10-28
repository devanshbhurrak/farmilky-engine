import { createApp } from './app.js';
import { configureEnv, isWorkersRuntime, validateEnv } from './shared/config/env.js';
import { configureDb } from './shared/db/client.js';
import { initCache } from './shared/cache/index.js';
import { configureStorage } from './shared/storage/types.js';
import { createR2BindingStorage } from './shared/storage/r2Binding.js';
import type { R2BucketLike } from './shared/storage/r2Binding.js';
import { runJobNow, type CronJobName } from './shared/jobs/dispatch.js';
import { configureRemoteBroadcast, sseManager } from './shared/realtime/sseManager.js';
import type { DurableObjectNamespaceLike } from './shared/types/index.js';
import { logger } from './shared/utils/logger.js';

export interface HyperdriveBinding {
  connectionString: string;
}

export interface Env {
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  IMAGES?: R2BucketLike;
  SSE_HUB?: DurableObjectNamespaceLike;
  // Vars + secrets are read dynamically through shared/config/env.ts
  [key: string]: unknown;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: Record<string, unknown>;
}

interface ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
}

// Cron expressions are UTC. Original schedules were IST:
//   05:00 IST daily  -> 23:30 UTC previous day
//   23:00 IST daily  -> 17:30 UTC
//   02:00 IST on 1st -> 20:30 UTC on the last day of the month
const CRON_SCHEDULE: Record<string, CronJobName | undefined> = {
  '30 23 * * *': 'daily-delivery',
  '30 17 * * *': 'end-of-day',
  '30 20 28-31 * *': 'monthly-invoice',
};

let app: ReturnType<typeof createApp> | undefined;
let initialized = false;

function prepare(env: Env): void {
  configureEnv(env, { runtime: 'workers' });
  validateEnv();
  configureDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  if (!initialized) {
    initCache();
    if (env.IMAGES) configureStorage(createR2BindingStorage(env.IMAGES));
    initialized = true;
  }
}

function getApp(env: Env): ReturnType<typeof createApp> {
  if (!app) {
    prepare(env);
    app = createApp();
  }
  return app;
}

function istDayOfMonth(now = Date.now()): number {
  return new Date(now + 5.5 * 60 * 60 * 1000).getUTCDate();
}

interface DurableObjectStateLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * All SSE connections are routed to one Durable Object so that broadcasts from
 * any Worker isolate reach every subscriber. The DO owns the streaming
 * response; the main Worker only forwards the request.
 */
export class SseHub {
  private readonly app: ReturnType<typeof createApp>;
  private readonly env: Env;
  private readonly ctx: ExecutionContextLike;

  constructor(state: DurableObjectStateLike, env: Env) {
    this.env = env;
    prepare(env);
    configureRemoteBroadcast(undefined);
    this.app = createApp();
    this.ctx = {
      waitUntil: (promise) => state.waitUntil(promise),
      passThroughOnException: () => undefined,
      props: {},
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/broadcast' && request.method === 'POST') {
      const body = (await request.json()) as {
        key: string;
        event: { type: string; [k: string]: unknown };
      };
      sseManager.broadcast(body.key, body.event);
      return new Response('ok');
    }
    return this.app.fetch(request, this.env, this.ctx);
  }
}

function hubStub(env: Env) {
  const namespace = env.SSE_HUB;
  if (!namespace) return undefined;
  return namespace.get(namespace.idFromName('global'));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/sse/')) {
      const stub = hubStub(env);
      if (stub) return stub.fetch(request);
    }

    const stub = hubStub(env);
    if (stub) {
      configureRemoteBroadcast((key, event) => {
        const body = JSON.stringify({ key, event });
        ctx.waitUntil(
          stub.fetch(
            new Request('https://sse.internal/internal/broadcast', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
            }),
          ),
        );
      });
    }

    try {
      return await getApp(env).fetch(request, env, ctx);
    } catch (err) {
      logger.error({ err }, 'Worker request failed');
      return Response.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
  },

  async scheduled(controller: ScheduledControllerLike, env: Env, _ctx: ExecutionContextLike): Promise<void> {
    prepare(env);
    const job = CRON_SCHEDULE[controller.cron];
    if (!job) {
      logger.warn({ cron: controller.cron }, 'Unknown cron trigger');
      return;
    }
    // The monthly invoice job is scheduled on the last 4 days of each month so
    // UTC→IST rollover is covered; only execute on the 1st in IST.
    if (job === 'monthly-invoice' && istDayOfMonth() !== 1) return;

    try {
      await runJobNow(job);
      logger.info({ job, cron: controller.cron }, 'Cron job completed');
    } catch (err) {
      logger.error({ err, job }, 'Cron job failed');
      throw err;
    }
  },
};

export { isWorkersRuntime };
