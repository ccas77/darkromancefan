import type { APIRoute } from 'astro';
import { q } from '../lib/db';
import { LEGAL, LEGAL_PAGES } from '../lib/legal';
import { allTropes } from '../lib/data';
import { tropeHref } from '../lib/tropes';

export const GET: APIRoute = async () => {
  const lists = await q(`SELECT slug, updated_at FROM lists WHERE status='published' AND deleted_at IS NULL`);
  const tropes = await allTropes();
  const books = await q(`SELECT slug, updated_at FROM books WHERE status='published' AND deleted_at IS NULL`);
  const u = (p: string, d?: any) => `<url><loc>https://www.darkromancefan.com${p}</loc>${d ? `<lastmod>${new Date(d).toISOString()}</lastmod>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
    u('/'), u('/lists'), u('/tropes'), u('/promote'), ...(LEGAL.APPROVED ? LEGAL_PAGES.map((l) => u(l.path)) : []), ...lists.map((l) => u(`/lists/${l.slug}`, l.updated_at)), ...tropes.map((t) => u(tropeHref(t.trope))), ...books.map((b) => u(`/books/${b.slug}`, b.updated_at)),
  ].join('')}</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml' } });
};
