import { env } from './env';

// Amazon Associates: amazon.com tag by default (most readers are in the US); OneLink on the
// Associates account sends other countries to their own store. -20 only earns on amazon.com.
const AMAZON_US_TAG = 'webref0f-20';

export function storeUrl(book: { title: string; author: string; isbn?: string | null; asin?: string | null }, store: string) {
  const kw = encodeURIComponent(`${book.title} ${book.author}`);
  if (store === 'bookshop') {
    const id = env('BOOKSHOP_AFFILIATE_ID');
    if (book.isbn && id) return `https://bookshop.org/a/${id}/${book.isbn}`;
    return `https://bookshop.org/search?keywords=${kw}`;
  }
  const tag = encodeURIComponent(env('AMAZON_TAG') || AMAZON_US_TAG);
  return book.asin
    ? `https://www.amazon.com/dp/${book.asin}?tag=${tag}`
    : `https://www.amazon.com/s?k=${kw}&i=stripbooks&tag=${tag}`;
}
