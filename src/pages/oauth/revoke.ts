import type { APIRoute } from 'astro';
import { q } from '../../lib/db';
import { sha } from '../../lib/oauth';
export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData().catch(() => null);
  const t = String(f?.get('token') || '');
  if (t) await q(`UPDATE oauth_tokens SET revoked=true WHERE token_hash=$1`, [sha(t)]);
  return new Response(null, { status: 200 });
};
