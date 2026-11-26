import type { APIRoute } from 'astro';
import { q, one, audit } from '../../lib/db';
import { screen } from '../../lib/moderation';
import { hash, ipHash, redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const f = await request.formData();
  const back = (m: string) => redirectBack(request, '/', `?c=${m}#comments`);
  if (String(f.get('website') || '')) return back('thanks'); // honeypot: bots fill this in
  const name = String(f.get('name') || '').trim().slice(0, 60);
  const email = String(f.get('email') || '').trim().toLowerCase().slice(0, 200);
  const body = String(f.get('body') || '').trim().slice(0, 4000);
  const spoiler = f.get('spoiler') === 'on';
  const bookId = Number(f.get('book_id')) || null;
  const listId = Number(f.get('list_id')) || null;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || body.length < 2 || (!bookId && !listId)) return back('invalid');

  const ip = ipHash(request, clientAddress);
  const recent = await one(`SELECT count(*)::int AS n FROM comments WHERE ip_hash=$1 AND created_at > now() - interval '1 minute'`, [ip]);
  if (recent!.n >= 3) return back('slow');

  const eh = hash('email:' + email);
  let c = await one(`SELECT * FROM commenters WHERE email_hash=$1`, [eh]);
  if (!c) c = await one(`INSERT INTO commenters (email_hash,email,name) VALUES ($1,$2,$3) RETURNING *`, [eh, email, name]);
  if (c!.banned) return back('thanks');

  const v = screen(body, name);
  // spam -> hidden; flagged -> owner/Claude review; trusted + clean -> live; first-timers -> held once
  const status = v.status === 'spam' ? 'spam' : v.status === 'flagged' ? 'flagged' : c!.trusted ? 'approved' : 'pending';
  const row = await one(`INSERT INTO comments (book_id,list_id,commenter_id,body,spoiler,status,flags,ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [bookId, listId, c!.id, body, spoiler, status, v.flags, ip]);
  await audit('reader', 'new_comment', `comment:${row!.id}`, { status, flags: v.flags });

  if (f.get('newsletter') === 'on') {
    await q(`INSERT INTO signups (email, source) VALUES ($1,'comment') ON CONFLICT DO NOTHING`, [email]);
    const { newsletterConfigured, subscribe } = await import('../../lib/newsletter');
    if (newsletterConfigured()) { const r = await subscribe(email, 'comment'); if (r.ok) await q(`UPDATE signups SET synced=true WHERE email=$1`, [email]); }
  }
  return back(status === 'approved' ? 'live' : status === 'spam' ? 'thanks' : 'held');
};
