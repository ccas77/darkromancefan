import type { AstroCookies } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { hash } from './util';

export function keyMatches(given: string) {
  const key = env('ADMIN_KEY');
  if (!key || key.length < 24 || !given) return false;
  const a = Buffer.from(hash('admin:' + given)); const b = Buffer.from(hash('admin:' + key));
  return timingSafeEqual(a, b);
}
export const isOwner = (cookies: AstroCookies) => {
  const v = cookies.get('drf_admin')?.value || '';
  const key = env('ADMIN_KEY');
  return Boolean(key && key.length >= 24 && v === hash('session:' + key));
};
export const startSession = (cookies: AstroCookies) =>
  cookies.set('drf_admin', hash('session:' + env('ADMIN_KEY')), { path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 14 });
