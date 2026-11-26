import type { APIRoute } from 'astro';
import { q, one } from '../../../lib/db';

const FILE = /^(\d{1,12})-([SML])\.jpg$/;
const MAX_BYTES = 3 * 1024 * 1024;
const YEAR = 'public, max-age=31536000, s-maxage=31536000, immutable';

export const GET: APIRoute = async ({ params }) => {
  const m = String(params.file ?? '').match(FILE);
  if (!m) return new Response('Not found', { status: 404 });
  const key = `ol:${m[1]}-${m[2]}`;
  const source = `https://covers.openlibrary.org/b/id/${m[1]}-${m[2]}.jpg`;

  const hit = await one<{ content_type: string; data: Uint8Array }>(
    'SELECT content_type, data FROM cover_cache WHERE key=$1', [key]);
  if (hit) return image(hit.data, hit.content_type);

  try {
    const res = await fetch(`${source}?default=false`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`status ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 200 || buf.byteLength > MAX_BYTES) throw new Error('bad size');
    await q('INSERT INTO cover_cache (key, content_type, data) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING', [key, type, Buffer.from(buf)]);
    return image(buf, type);
  } catch {
    // Open Library is slow or the cover is gone: send the browser there directly, and don't cache the miss for long.
    return new Response(null, { status: 302, headers: { Location: source, 'Cache-Control': 'public, max-age=300' } });
  }
};

function image(data: Uint8Array, type: string) {
  return new Response(data as any, { headers: { 'Content-Type': type, 'Cache-Control': YEAR } });
}
