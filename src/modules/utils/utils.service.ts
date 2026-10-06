import { AppError } from '../../shared/middleware/errorHandler.js';

// Resolves a shortened Google Maps URL to coordinates by following
// redirects and parsing the `@lat,lng,zoom` fragment.
export async function resolveMapsLink(shortUrl: string): Promise<{ lat: number; lng: number }> {
  let url = shortUrl;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('Invalid URL', 400);
  }
  if (!/maps|goo\.gl|google/i.test(parsed.hostname + parsed.pathname)) {
    throw new AppError('URL does not look like a Google Maps link', 400);
  }

  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const finalUrl = res.url || url;
  const match = finalUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$)/);
  if (!match) throw new AppError('Could not extract coordinates from link', 422);
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new AppError('Could not extract coordinates from link', 422);
  return { lat, lng };
}
