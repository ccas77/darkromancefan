import type { APIRoute } from 'astro';
import { q, one } from '../../lib/db';
import { storeUrl } from '../../lib/links';

// Bots, link checkers, previews and prefetches are redirected but not counted.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|httpx|axios|node-fetch|go-http|java\/|headless|lighthouse|pingdom|uptime|monitor|scan/i;

// Outbound buy links go through here so real reader clicks can be counted for reporting.
export const GET: APIRoute = async ({ params, url, request }) => {
  const store = url.searchParams.get('store') === 'bookshop' ? 'bookshop' : 'amazon';
  const book = await one(`SELECT * FROM books WHERE slug=$1 AND deleted_at IS NULL`, [params.slug]);
  if (!book) return new Response('Not found', { status: 404 });
  const ua = request.headers.get('user-agent') || '';
  const prefetch = /prefetch|prerender/i.test(request.headers.get('sec-purpose') || request.headers.get('purpose') || '');
  if (ua && !BOT.test(ua) && !prefetch) await q(`INSERT INTO clicks (book_id, store) VALUES ($1,$2)`, [book.id, store]);
  return new Response(null, { status: 302, headers: { Location: storeUrl(book, store), 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
};
