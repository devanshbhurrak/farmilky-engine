import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { EnqueueOpts, JobHandler, JobQueueAdapter } from './types.js';
import { logger } from '../utils/logger.js';

export class BullmqAdapter implements JobQueueAdapter {
  private connection: Redis;
  private queues = new Map<string, Queue>();
  private workers: Worker[] = [];

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  private getQueue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(queue: string, payload: unknown, opts?: EnqueueOpts): Promise<void> {
    const q = this.getQueue(queue);
    const jobOpts: JobsOptions = { attempts: opts?.maxAttempts ?? 3, backoff: { type: 'exponential', delay: 60_000 } };
    if (opts?.runAt) jobOpts.delay = Math.max(0, opts.runAt.getTime() - Date.now());
    await q.add(queue, payload as Record<string, unknown>, jobOpts);
  }

  registerProcessor(queue: string, handler: JobHandler): void {
    const worker = new Worker(
      queue,
      async (job) => {
        await handler(job.data as Record<string, unknown>);
      },
      { connection: this.connection },
    );
    worker.on('failed', (job, err) => {
      logger.error({ queue, jobId: job?.id, err }, 'Background job failed');
    });
    this.workers.push(worker);
  }

  startWorkers(): void {
    logger.info({ workers: this.workers.length }, 'BullMQ workers started');
  }

  async stopWorkers(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    this.connection.disconnect();
  }

  async scheduleRecurring(name: string, cronIST: string, queue: string, payload: unknown): Promise<void> {
    // Recurring schedules are expressed in IST wall-clock. BullMQ supports a
    // tz option on repeat, so the pattern fires at the right IST hour even
    // when the server runs on UTC.
    const q = this.getQueue(queue);
    await q.add(name, payload as Record<string, unknown>, {
      repeat: { pattern: cronIST, tz: 'Asia/Kolkata' },
      jobId: `recurring:${name}`,
    });
  }
}
