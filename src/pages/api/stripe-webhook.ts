import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { q, audit } from '../../lib/db';
import { env } from '../../lib/env';
import { packageForLink } from '../../lib/packages';

function verify(payload: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t; const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.text();
  if (!verify(payload, request.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'))) {
    return new Response('Bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const field = (key: string) => {
      const f = (s.custom_fields || []).find((x: any) => x.key === key);
      return f?.text?.value || f?.dropdown?.value || '';
    };
    await q(`INSERT INTO promo_bookings (stripe_session_id,package,author_name,author_email,book_title,book_url,preferred_date,amount_cents,currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (stripe_session_id) DO NOTHING`, [
      s.id, packageForLink(s.payment_link) || s.metadata?.package || 'unknown',
      s.customer_details?.name || '', s.customer_details?.email || '',
      field('booktitle') || field('book_title'), field('booklink') || field('book_link'), field('preferreddate') || field('preferred_date'),
      s.amount_total || 0, s.currency || 'usd',
    ]);
    await audit('stripe', 'new_promo_booking', s.id);
  }
  return new Response('ok');
};
