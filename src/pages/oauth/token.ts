import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { q, one } from '../../lib/db';
import { sha, issueTokens, json } from '../../lib/oauth';

async function params(request: Request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return new Map(Object.entries(await request.json() as any)); } catch { return new Map(); } }
  return new Map((await request.formData()).entries() as any) as Map<string, any>;
}
const err = (e: string, d = '') => json({ error: e, error_description: d }, 400);

export const POST: APIRoute = async ({ request }) => {
  const p = await params(request);
  const grant = String(p.get('grant_type') || '');
  const clientId = String(p.get('client_id') || '');
  if (grant === 'authorization_code') {
    const code = String(p.get('code') || ''), verifier = String(p.get('code_verifier') || ''), redirect = String(p.get('redirect_uri') || '');
    const row = await one(`SELECT * FROM oauth_codes WHERE code_hash=$1`, [sha(code)]);
    if (!row || row.used || new Date(row.expires_at) < new Date()) return err('invalid_grant', 'Code expired or already used');
    await q(`UPDATE oauth_codes SET used=true WHERE code_hash=$1`, [sha(code)]);
    if (clientId && clientId !== row.client_id) return err('invalid_grant', 'Client mismatch');
    if (redirect && redirect !== row.redirect_uri) return err('invalid_grant', 'Redirect mismatch');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!verifier || challenge !== row.code_challenge) return err('invalid_grant', 'PKCE check failed');
    return json(await issueTokens(row.client_id));
  }
  if (grant === 'refresh_token') {
    const rt = String(p.get('refresh_token') || '');
    const row = await one(`SELECT * FROM oauth_tokens WHERE token_hash=$1 AND kind='refresh' AND NOT revoked AND expires_at > now()`, [sha(rt)]);
    if (!row) return err('invalid_grant', 'Refresh token invalid');
    await q(`UPDATE oauth_tokens SET revoked=true WHERE token_hash=$1`, [sha(rt)]);
    return json(await issueTokens(row.client_id));
  }
  return err('unsupported_grant_type');
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' } });
