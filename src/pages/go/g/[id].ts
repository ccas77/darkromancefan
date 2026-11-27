import type { APIRoute } from 'astro';
import { q, one } from '../../../lib/db';
import { storeUrl } from '../../../lib/links';
import { isBot } from '../../../lib/bots';

// Buy links on /best guides. Counted per guide item.
export const GET: APIRoute = async ({ params, request }) => {
  const r = await one(`SELECT * FROM guide_items WHERE id=$1`, [Number(params.id) || 0]);
  if (!r) return new Response('Not found', { status: 404 });
  if (!isBot(request)) await q(`INSERT INTO clicks (book_id, store, guide_item_id) VALUES (0,'amazon',$1)`, [r.id]);
  return new Response(null, { status: 302, headers: { Location: storeUrl(r, 'amazon'), 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
};
