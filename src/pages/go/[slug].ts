import type { APIRoute } from 'astro';
import { q, one } from '../../lib/db';
import { storeUrl } from '../../lib/links';

// Outbound buy links go through here so clicks can be counted for reporting.
export const GET: APIRoute = async ({ params, url }) => {
  const store = url.searchParams.get('store') === 'bookshop' ? 'bookshop' : 'amazon';
  const book = await one(`SELECT * FROM books WHERE slug=$1 AND deleted_at IS NULL`, [params.slug]);
  if (!book) return new Response('Not found', { status: 404 });
  await q(`INSERT INTO clicks (book_id, store) VALUES ($1,$2)`, [book.id, store]);
  return new Response(null, { status: 302, headers: { Location: storeUrl(book, store), 'X-Robots-Tag': 'noindex' } });
};
