import { env } from './env';

// Built-in spam signals. Add your own blocked words with the BLOCKED_WORDS setting.
const SPAM_PATTERNS = [
  /\b(viagra|cialis|casino|crypto ?(signal|invest)|forex|loan offer|seo services|backlinks?)\b/i,
  /\b(whats ?app|telegram) me\b/i,
  /\b(onlyfans\.com|bit\.ly|t\.me\/)/i,
];

export type Verdict = { status: 'spam' | 'flagged' | 'ok'; flags: string[] };

export function screen(body: string, name: string): Verdict {
  const flags: string[] = [];
  const text = body + ' ' + name;
  const links = (body.match(/https?:\/\/|www\./gi) || []).length;
  if (SPAM_PATTERNS.some((r) => r.test(text))) flags.push('spam-pattern');
  if (links >= 3) flags.push('many-links');
  if (flags.length) return { status: 'spam', flags };

  if (links > 0) flags.push('contains-link');
  const blocked = env('BLOCKED_WORDS').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (blocked.some((w) => text.toLowerCase().includes(w))) flags.push('blocked-word');
  const letters = body.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 20 && letters === letters.toUpperCase()) flags.push('all-caps');
  if (/(\+?\d[\d\s().-]{8,}\d)/.test(body) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(body)) flags.push('personal-info');
  return { status: flags.length ? 'flagged' : 'ok', flags };
}
