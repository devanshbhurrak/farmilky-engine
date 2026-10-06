// Package entry — side-effect free. Use server.ts to run the Node server,
// worker.ts for Cloudflare Workers, app.ts (buildApp/createApp) in tests.
export { buildApp, createApp } from './app.js';
