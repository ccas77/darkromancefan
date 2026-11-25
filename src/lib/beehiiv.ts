import { env } from './env';

const API = 'https://api.beehiiv.com/v2';
export const beehiivConfigured = () => Boolean(env('BEEHIIV_API_KEY') && env('BEEHIIV_PUBLICATION_ID'));

async function call(path: string, body: any) {
  const res = await fetch(`${API}/publications/${env('BEEHIIV_PUBLICATION_ID')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('BEEHIIV_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
}

export function subscribe(email: string, source: string) {
  return call('/subscriptions', {
    email, reactivate_existing: false, send_welcome_email: true,
    utm_source: 'darkromancefan.com', utm_medium: source,
  });
}

/** Creates a DRAFT post. It never schedules or sends. Some Beehiiv plans don't allow this through the API. */
export function createDraftPost(title: string, html: string) {
  return call('/posts', { title, body_content: html, status: 'draft' });
}
