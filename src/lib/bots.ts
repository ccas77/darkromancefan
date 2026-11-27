// Bots, link checkers, previews and prefetches are redirected but not counted as clicks.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|httpx|axios|node-fetch|go-http|java\/|headless|lighthouse|pingdom|uptime|monitor|scan/i;

export function isBot(request: Request) {
  const ua = request.headers.get('user-agent') || '';
  const prefetch = /prefetch|prerender/i.test(request.headers.get('sec-purpose') || request.headers.get('purpose') || '');
  return !ua || BOT.test(ua) || prefetch;
}
