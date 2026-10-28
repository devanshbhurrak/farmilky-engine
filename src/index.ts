// Package entry — side-effect free. Use server.ts to run the Node server,
// worker.ts for Cloudflare Workers, app.ts (createApp) in tests.
export { createApp } from './app.js';
export { buildApp } from './bootstrap.js';
