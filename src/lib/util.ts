import { createHash, randomUUID } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env } from './env';

export const hash = (s: string) => createHash('sha256').update(env('HASH_SALT') + '|' + s).digest('hex').slice(0, 32);

export function voterId(cookies: AstroCookies): string {
  let id = cookies.get('drf_vid')?.value;
  if (!id) {
    id = randomUUID();
    cookies.set('drf_vid', id, { path: '/', maxAge: 60 * 60 * 24 * 365 * 2, httpOnly: true, sameSite: 'lax' });
  }
  return hash('voter:' + id);
}

export function ipHash(request: Request, clientAddress?: string) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'local';
  return hash('ip:' + ip);
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Escape, then turn ||text|| into inline spoilers and line breaks into <br>. */
export function renderComment(body: string) {
  return esc(body)
    .replace(/\|\|(.+?)\|\|/gs, '<span class="spoiler" tabindex="0" title="Spoiler: tap to reveal">$1</span>')
    .replace(/\n/g, '<br>');
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function redirectBack(request: Request, fallback: string, extra = '') {
  const ref = request.headers.get('referer');
  let target = fallback;
  try { if (ref) { const u = new URL(ref); target = u.pathname; } } catch {}
  return new Response(null, { status: 303, headers: { Location: target + extra } });
}

export const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
