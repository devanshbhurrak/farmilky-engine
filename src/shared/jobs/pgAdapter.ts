import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobQueue } from '../db/schema/index.js';
import type { EnqueueOpts, JobHandler, JobQueueAdapter } from './types.js';
import { logger } from '../utils/logger.js';

// PostgreSQL-backed job queue fallback (used when REDIS_URL is not set).
// Polls with SELECT ... FOR UPDATE SKIP LOCKED every 5s.
export class PgAdapter implements JobQueueAdapter {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | undefined;
  private workerId = randomUUID();
  private running = false;

  async enqueue(queue: string, payload: unknown, opts?: EnqueueOpts): Promise<void> {
    await db.insert(jobQueue).values({
      queueName: queue,
      payload: payload as Record<string, unknown>,
      status: 'pending',
      maxAttempts: opts?.maxAttempts ?? 3,
      runAt: opts?.runAt ?? new Date(),
    });
  }

  registerProcessor(queue: string, handler: JobHandler): void {
    this.handlers.set(queue, handler);
  }

  startWorkers(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 5000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    logger.info('pg job queue worker started (5s poll)');
  }

  async stopWorkers(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async scheduleRecurring(name: string, cronIST: string, queue: string, payload: unknown): Promise<void> {
    const next = nextRunFromCron(cronIST);
    // Upsert a sentinel recurring row; after each run it re-schedules itself.
    const existing = await db
      .select({ id: jobQueue.id })
      .from(jobQueue)
      .where(and(eq(jobQueue.queueName, queue), eq(jobQueue.status, 'recurring'), sql`${jobQueue.payload}->>'recurringName' = ${name}`))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(jobQueue).values({
        queueName: queue,
        payload: { ...(payload as Record<string, unknown>), recurringName: name, recurringCron: cronIST },
        status: 'recurring',
        runAt: next,
      });
    }
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await db.execute(sql`
        UPDATE job_queue
        SET status = 'running', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1, updated_at = now()
        WHERE id IN (
          SELECT id FROM job_queue
          WHERE status IN ('pending', 'recurring') AND run_at <= now()
          ORDER BY run_at ASC
          LIMIT 5
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, queue_name, payload, attempts, max_attempts
      `);
      const rows = (claimed as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
      for (const row of rows) {
        await this.runJob(row);
      }
    } catch (err) {
      logger.error({ err }, 'pg job queue poll error');
    } finally {
      this.running = false;
    }
  }

  private async runJob(row: Record<string, unknown>): Promise<void> {
    const id = String(row['id']);
    const queue = String(row['queue_name']);
    const payload = (row['payload'] ?? {}) as Record<string, unknown>;
    const attempts = Number(row['attempts'] ?? 1);
    const maxAttempts = Number(row['max_attempts'] ?? 3);
    const handler = this.handlers.get(queue);
    const isRecurring = payload['recurringName'] != null;

    if (!handler) {
      logger.warn({ queue }, 'No processor registered for queue');
      await db.update(jobQueue).set({ status: 'pending', lockedBy: null }).where(eq(jobQueue.id, id));
      return;
    }

    try {
      await handler(payload);
      if (isRecurring) {
        const cron = String(payload['recurringCron'] ?? '');
        await db
          .update(jobQueue)
          .set({ status: 'recurring', lockedBy: null, lockedAt: null, lastError: null, runAt: nextRunFromCron(cron), updatedAt: new Date() })
          .where(eq(jobQueue.id, id));
      } else {
        await db.update(jobQueue).set({ status: 'completed', lockedBy: null, updatedAt: new Date() }).where(eq(jobQueue.id, id));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ queue, id, err }, 'pg job failed');
      if (attempts >= maxAttempts && !isRecurring) {
        await db
          .update(jobQueue)
          .set({ status: 'failed', lockedBy: null, lastError: message, updatedAt: new Date() })
          .where(eq(jobQueue.id, id));
      } else {
        const backoffMinutes = Math.pow(2, attempts);
        await db.execute(sql`
          UPDATE job_queue
          SET status = ${isRecurring ? 'recurring' : 'pending'}, locked_by = NULL, locked_at = NULL,
              last_error = ${message}, run_at = now() + (${backoffMinutes} || ' minutes')::interval,
              updated_at = now()
          WHERE id = ${id}::uuid
        `);
      }
    }
  }
}

// Minimal cron "M H * * *" (or "M H D * *") → next run. The schedules are
// IST wall-clock: arithmetic is done on IST-shifted time so the pg fallback
// fires at the same local hour as the BullMQ path (which uses tz).
// Supports the three recurring schedules used by the app; falls back to +24h.
export function nextRunFromCron(cron: string, nowInput: Date = new Date()): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const parts = cron.trim().split(/\s+/);
  const fallback = new Date(nowInput.getTime() + 24 * 3600 * 1000);
  if (parts.length < 5) return fallback;
  const minute = parts[0] === '*' ? null : Number(parts[0]);
  const hour = parts[1] === '*' ? null : Number(parts[1]);
  const dayOfMonth = parts[2];
  if ((minute !== null && !Number.isFinite(minute)) || (hour !== null && !Number.isFinite(hour))) {
    return fallback;
  }
  // Work in IST wall-clock, then convert back to an absolute timestamp.
  const istNow = new Date(nowInput.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const mo = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const h = hour ?? istNow.getUTCHours();
  const mi = minute ?? istNow.getUTCMinutes();
  let istTarget: Date;
  if (dayOfMonth !== '*') {
    const target = Number(dayOfMonth);
    if (!Number.isFinite(target)) return fallback;
    istTarget = new Date(Date.UTC(y, mo, target, h, mi, 0, 0));
    if (istTarget.getTime() <= istNow.getTime()) {
      istTarget = new Date(Date.UTC(y, mo + 1, target, h, mi, 0, 0));
    }
  } else {
    istTarget = new Date(Date.UTC(y, mo, d, h, mi, 0, 0));
    if (istTarget.getTime() <= istNow.getTime()) {
      istTarget = new Date(istTarget.getTime() + 24 * 3600 * 1000);
    }
  }
  return new Date(istTarget.getTime() - IST_OFFSET_MS);
}
