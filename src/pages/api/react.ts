import type { APIRoute } from 'astro';
import { q } from '../../lib/db';
import { voterId, redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request, cookies }) => {
  const f = await request.formData();
  const bookId = Number(f.get('book_id'));
  const kind = String(f.get('kind'));
  if (bookId && ['loved', 'dnf', 'tbr'].includes(kind)) {
    await q(`INSERT INTO reactions (book_id,voter,kind) VALUES ($1,$2,$3) ON CONFLICT (book_id,voter) DO UPDATE SET kind=$3`,
      [bookId, voterId(cookies), kind]);
  }
  return redirectBack(request, '/', '#react');
};
