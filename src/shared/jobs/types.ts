export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface EnqueueOpts {
  runAt?: Date;
  maxAttempts?: number;
}

export interface JobQueueAdapter {
  enqueue(queue: string, payload: unknown, opts?: EnqueueOpts): Promise<void>;
  registerProcessor(queue: string, handler: JobHandler): void;
  startWorkers(): void;
  stopWorkers?(): Promise<void> | void;
  scheduleRecurring(name: string, cronIST: string, queue: string, payload: unknown): Promise<void>;
}
