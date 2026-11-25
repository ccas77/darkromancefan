import type { APIRoute } from 'astro';
import { q } from '../../lib/db';
import { voterId, redirectBack } from '../../lib/util';

const clamp = (v: any) => Math.min(5, Math.max(1, Math.round(Number(v) || 0)));

export const POST: APIRoute = async ({ request, cookies }) => {
  const f = await request.formData();
  const bookId = Number(f.get('book_id'));
  if (!bookId || !f.get('overall')) return redirectBack(request, '/', '#rate');
  await q(`INSERT INTO ratings (book_id,voter,overall,spice,darkness) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (book_id,voter) DO UPDATE SET overall=$3, spice=$4, darkness=$5, created_at=now()`,
    [bookId, voterId(cookies), clamp(f.get('overall')), clamp(f.get('spice') || 1), clamp(f.get('darkness') || 1)]);
  return redirectBack(request, '/', '?r=1#rate');
};
