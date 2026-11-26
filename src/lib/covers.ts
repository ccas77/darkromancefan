/**
 * Covers are served from this site (/covers/ol/<id>-L.jpg) instead of hot-linking Open Library.
 * The first request fetches the image from Open Library and stores it in the database;
 * later requests are served from the database and cached by Vercel's CDN for a year.
 */
const OL = /^https?:\/\/covers\.openlibrary\.org\/b\/id\/(\d+)-([SML])\.jpg(?:\?.*)?$/i;

/** Turn an Open Library cover URL into the site's own cover path. Other URLs pass through. */
export function coverSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(OL);
  return m ? `/covers/ol/${m[1]}-${m[2].toUpperCase()}.jpg` : url;
}

/** Absolute URL, for og:image and JSON-LD. */
export function coverAbs(url: string | null | undefined, site: URL | string | undefined): string | undefined {
  const s = coverSrc(url);
  if (!s) return undefined;
  return s.startsWith('/') && site ? new URL(s, site).toString() : s;
}
