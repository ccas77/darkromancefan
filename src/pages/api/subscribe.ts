import type { APIRoute } from 'astro';
import { q } from '../../lib/db';
import { newsletterConfigured, subscribe } from '../../lib/newsletter';
import { redirectBack } from '../../lib/util';

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const email = String(f.get('email') || '').trim().toLowerCase();
  if (String(f.get('website') || '') || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirectBack(request, '/', '?sub=bad#signup');
  const source = String(f.get('source') || 'site').slice(0, 40);
  await q(`INSERT INTO signups (email, source) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [email, source]);
  if (newsletterConfigured()) {
    const r = await subscribe(email, source);
    if (r.ok) await q(`UPDATE signups SET synced=true WHERE email=$1`, [email]);
  }
  return redirectBack(request, '/', '?sub=ok#signup');
};
