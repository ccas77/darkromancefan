import type { APIRoute } from 'astro';
import { q, one } from '../../../lib/db';
import { storeUrl } from '../../../lib/links';
import { isBot } from '../../../lib/bots';

// Buy links for "books like X" recommendations. Counted against the page they were clicked on.
export const GET: APIRoute = async ({ params, request }) => {
  const r = await one(`SELECT * FROM book_recs WHERE id=$1`, [Number(params.id) || 0]);
  if (!r) return new Response('Not found', { status: 404 });
  if (!isBot(request)) await q(`INSERT INTO clicks (book_id, store, rec_id) VALUES ($1,'amazon',$2)`, [r.book_id, r.id]);
  return new Response(null, { status: 302, headers: { Location: storeUrl(r, 'amazon'), 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
};
