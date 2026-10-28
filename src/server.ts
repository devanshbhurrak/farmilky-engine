import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildApp } from './bootstrap.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

const app = await buildApp();

serve({ fetch: app.fetch, port: env.port }, () => logger.info(`Farmilky API on :${env.port}`));
