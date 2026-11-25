import type { APIRoute } from 'astro';
import { registerClient, json } from '../../lib/oauth';
export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch {}
  const c = await registerClient(body);
  return c ? json(c, 201) : json({ error: 'invalid_redirect_uri', error_description: 'At least one https redirect_uri is required' }, 400);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
