import { env } from './env';

export function storeUrl(book: { title: string; author: string; isbn?: string | null; asin?: string | null }, store: string) {
  const kw = encodeURIComponent(`${book.title} ${book.author}`);
  if (store === 'bookshop') {
    const id = env('BOOKSHOP_AFFILIATE_ID');
    if (book.isbn && id) return `https://bookshop.org/a/${id}/${book.isbn}`;
    return `https://bookshop.org/search?keywords=${kw}`;
  }
  const tag = env('AMAZON_TAG');
  const base = book.asin ? `https://www.amazon.com/dp/${book.asin}` : `https://www.amazon.com/s?k=${kw}`;
  return tag ? `${base}${base.includes('?') ? '&' : '?'}tag=${encodeURIComponent(tag)}` : base;
}
