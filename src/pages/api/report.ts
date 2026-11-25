import type { APIRoute } from 'astro';
import { q, audit } from '../../lib/db';
import { redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const id = Number(f.get('comment_id'));
  if (id) {
    await q(`INSERT INTO reports (comment_id, reason) VALUES ($1,$2)`, [id, String(f.get('reason') || '').slice(0, 300)]);
    await audit('reader', 'report_comment', `comment:${id}`);
  }
  return redirectBack(request, '/', '?reported=1#comments');
};
