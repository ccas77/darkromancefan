// Minimal OAuth 2.1 (authorization code + PKCE, dynamic client registration) so Claude can
// connect to https://www.darkromancefan.com/mcp with a normal sign-in instead of a key in the URL.
import { createHash, randomBytes } from 'node:crypto';
import { q, one, audit } from './db';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

export function origin(request: Request) {
  const u = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || u.host;
  return `${proto}://${host}`;
}

export const ACCESS_TTL_DAYS = 30;
export const REFRESH_TTL_DAYS = 365;

export async function issueTokens(clientId: string) {
  const access = token(), refresh = token();
  await q(`INSERT INTO oauth_tokens (token_hash, kind, client_id, expires_at) VALUES
    ($1,'access',$3, now() + interval '${ACCESS_TTL_DAYS} days'), ($2,'refresh',$3, now() + interval '${REFRESH_TTL_DAYS} days')`,
    [sha(access), sha(refresh), clientId]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_DAYS * 86400, refresh_token: refresh, scope: 'admin' };
}

export async function validAccess(request: Request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const row = await one(`SELECT 1 AS ok FROM oauth_tokens WHERE token_hash=$1 AND kind='access' AND NOT revoked AND expires_at > now()`, [sha(m[1].trim())]);
  return Boolean(row);
}

export async function registerClient(body: any) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u: any) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 10) : [];
  if (!uris.length) return null;
  const id = 'drf_' + token().slice(0, 24);
  await q(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1,$2,$3)`, [id, String(body.client_name || '').slice(0, 100), uris]);
  await audit('system', 'oauth_client_registered', id, String(body.client_name || ''));
  return { client_id: id, client_name: body.client_name || '', redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none' };
}

export const getClient = (id: string) => one<{ client_id: string; client_name: string; redirect_uris: string[] }>(`SELECT * FROM oauth_clients WHERE client_id=$1`, [id]);

export const json = (data: any, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra } });
