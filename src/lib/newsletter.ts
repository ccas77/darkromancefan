// Newsletter provider: Kit (kit.com), API v4. Set KIT_API_KEY (Kit → Settings → Developer → API key, v4).
// Optional KIT_FORM_ID adds sign-ups to a Kit form so they show where they came from.
// New subscribers are added to the "Welcome" sequence in Kit (KIT_WELCOME_SEQUENCE_ID overrides the default).
// The site also keeps its own copy of every sign-up (signups table), so moving provider later is a CSV export.
import { env } from './env';

const API = 'https://api.kit.com/v4';
const WELCOME_SEQUENCE = '2989227';
export const PROVIDER = 'Kit';
export const newsletterConfigured = () => Boolean(env('KIT_API_KEY'));

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'X-Kit-Api-Key': env('KIT_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
}

/** Adds (or updates) an active subscriber. Readers sign up with an explicit opt-in on the site. */
export async function subscribe(email: string, source: string) {
  const r = await call('POST', '/subscribers', { email_address: email, state: 'active', fields: { source } });
  const form = env('KIT_FORM_ID');
  if (r.ok && form) await call('POST', `/forms/${encodeURIComponent(form)}/subscribers`, { email_address: email, referrer: `https://www.darkromancefan.com/?src=${encodeURIComponent(source)}` });
  // 201 = a brand-new subscriber: send them the welcome email. Existing subscribers aren't welcomed twice.
  if (r.status === 201) {
    const seq = env('KIT_WELCOME_SEQUENCE_ID') || WELCOME_SEQUENCE;
    const w = await call('POST', `/sequences/${encodeURIComponent(seq)}/subscribers`, { email_address: email });
    if (!w.ok) console.error('Kit welcome sequence failed', w.status, JSON.stringify(w.data).slice(0, 300));
  }
  return r;
}

/** Updates an existing DRAFT broadcast in Kit (still unscheduled and unsent). */
export function updateDraft(id: string, subject: string, html: string) {
  return call('PUT', `/broadcasts/${encodeURIComponent(id)}`, { subject, content: html, public: false, send_at: null });
}

/** Creates a DRAFT broadcast in Kit. send_at null + public false = never sent or scheduled. */
export function createDraft(subject: string, html: string) {
  return call('POST', '/broadcasts', { subject, content: html, public: false, send_at: null, description: 'Drafted by Claude for review' });
}
