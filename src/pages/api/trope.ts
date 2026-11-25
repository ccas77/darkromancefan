import type { APIRoute } from 'astro';
import { q } from '../../lib/db';
import { voterId, redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request, cookies }) => {
  const f = await request.formData();
  const bookId = Number(f.get('book_id'));
  const trope = String(f.get('trope') || '').toLowerCase().replace(/[^a-z0-9 '-]/g, '').trim().slice(0, 40);
  if (bookId && trope.length >= 3) {
    await q(`INSERT INTO trope_votes (book_id,trope,voter) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [bookId, trope, voterId(cookies)]);
  }
  return redirectBack(request, '/', '#tropes');
};
