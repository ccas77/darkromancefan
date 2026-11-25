import type { APIRoute } from 'astro';
import { keyMatches, startSession } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const f = await request.formData();
  if (keyMatches(String(f.get('key') || ''))) { startSession(cookies); return new Response(null, { status: 303, headers: { Location: '/admin' } }); }
  return new Response(null, { status: 303, headers: { Location: '/admin?bad=1' } });
};
