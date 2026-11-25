import type { APIRoute } from 'astro';
import { q } from '../lib/db';

export const GET: APIRoute = async () => {
  const lists = await q(`SELECT slug, updated_at FROM lists WHERE status='published' AND deleted_at IS NULL`);
  const books = await q(`SELECT slug, updated_at FROM books WHERE status='published' AND deleted_at IS NULL`);
  const u = (p: string, d?: any) => `<url><loc>https://darkromancefan.com${p}</loc>${d ? `<lastmod>${new Date(d).toISOString()}</lastmod>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
    u('/'), u('/lists'), u('/promote'), ...lists.map((l) => u(`/lists/${l.slug}`, l.updated_at)), ...books.map((b) => u(`/books/${b.slug}`, b.updated_at)),
  ].join('')}</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml' } });
};
