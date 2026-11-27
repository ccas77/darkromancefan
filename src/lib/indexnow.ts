// IndexNow: tells Bing (and engines that share its index) about new or changed pages straight away.
const KEY = 'a2389eb8ac7b4577fed535a7f6fb4c84';
const HOST = 'www.darkromancefan.com';

export async function pingIndexNow(paths: string[]) {
  if (process.env.VERCEL_ENV !== 'production' || !paths.length) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: paths.map((p) => `https://${HOST}${p}`) }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* best effort */ }
}
