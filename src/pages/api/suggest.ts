import type { APIRoute } from 'astro';
import { q, one, audit } from '../../lib/db';
import { ipHash, redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const f = await request.formData();
  if (String(f.get('website') || '')) return redirectBack(request, '/', '?s=1#suggest');
  const title = String(f.get('title') || '').trim().slice(0, 150);
  const author = String(f.get('author') || '').trim().slice(0, 100);
  const note = String(f.get('note') || '').trim().slice(0, 500);
  const listId = Number(f.get('list_id')) || null;
  const ip = ipHash(request, clientAddress);
  const recent = await one(`SELECT count(*)::int AS n FROM suggestions WHERE ip_hash=$1 AND created_at > now() - interval '10 minutes'`, [ip]);
  if (title.length >= 2 && recent!.n < 5) {
    const row = await one(`INSERT INTO suggestions (list_id,title,author,note,ip_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [listId, title, author, note, ip]);
    await audit('reader', 'new_suggestion', `suggestion:${row!.id}`, `${title} by ${author}`);
  }
  return redirectBack(request, '/', '?s=1#suggest');
};
