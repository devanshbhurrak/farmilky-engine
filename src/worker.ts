import { buildApp } from './app.js';

// Cloudflare Workers entry. The app is built lazily on first request and
// cached for the isolate lifetime — importing this module has no side effects.
let appPromise: ReturnType<typeof buildApp> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    if (!appPromise) appPromise = buildApp();
    const app = await appPromise;
    return app.fetch(request);
  },
};
