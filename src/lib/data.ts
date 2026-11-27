import { q, one } from './db';

export type Book = {
  id: number; slug: string; title: string; author: string; series: string | null; blurb: string;
  tropes: string[]; content_note: string; isbn: string | null; asin: string | null; cover_url: string | null; year: number | null; status: string; featured: boolean;
};

export const publishedLists = () =>
  q(`SELECT l.*, (SELECT count(*)::int FROM list_items i JOIN books b ON b.id=i.book_id
        WHERE i.list_id=l.id AND b.status='published' AND b.deleted_at IS NULL) AS book_count
     FROM lists l WHERE l.status='published' AND l.deleted_at IS NULL ORDER BY l.created_at DESC`);

export const listBySlug = (slug: string) =>
  one(`SELECT * FROM lists WHERE slug=$1 AND status='published' AND deleted_at IS NULL`, [slug]);

export const listBooks = (listId: number) =>
  q<Book & { note: string }>(`SELECT b.*, i.note FROM list_items i JOIN books b ON b.id=i.book_id
     WHERE i.list_id=$1 AND b.status='published' AND b.deleted_at IS NULL ORDER BY i.position`, [listId]);

export const bookBySlug = (slug: string) =>
  one<Book>(`SELECT * FROM books WHERE slug=$1 AND status='published' AND deleted_at IS NULL`, [slug]);

export const featuredBooks = () =>
  q<Book>(`SELECT * FROM books WHERE featured AND status='published' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3`)

export const allPublishedBooks = () =>
  q<Book>(`SELECT * FROM books WHERE status='published' AND deleted_at IS NULL ORDER BY featured DESC, created_at DESC LIMIT 24`);

export const listCovers = async () => {
  const rows = await q(`SELECT i.list_id, b.cover_url, b.title FROM list_items i JOIN books b ON b.id=i.book_id
     WHERE b.status='published' AND b.deleted_at IS NULL ORDER BY i.position`);
  const m: Record<number, { cover_url: string | null; title: string }[]> = {};
  for (const r of rows) (m[r.list_id] ??= []).push(r);
  return m;
};;

export const listsForBook = (bookId: number) =>
  q(`SELECT l.slug, l.title FROM list_items i JOIN lists l ON l.id=i.list_id
     WHERE i.book_id=$1 AND l.status='published' AND l.deleted_at IS NULL`, [bookId]);

export async function ratingSummary(bookId: number) {
  return (await one(`SELECT count(*)::int AS n, round(avg(overall),1)::float AS overall,
      round(avg(spice),1)::float AS spice, round(avg(darkness),1)::float AS darkness FROM ratings WHERE book_id=$1`, [bookId]))!;
}

export const ratingsForBooks = async (ids: number[]) => {
  if (!ids.length) return {} as Record<number, any>;
  const rows = await q(`SELECT book_id, count(*)::int AS n, round(avg(overall),1)::float AS overall,
      round(avg(spice),1)::float AS spice, round(avg(darkness),1)::float AS darkness
      FROM ratings WHERE book_id = ANY($1::int[]) GROUP BY book_id`, [ids]);
  return Object.fromEntries(rows.map((r) => [r.book_id, r]));
};

export const tropeTally = (bookId: number) =>
  q<{ trope: string; n: number }>(`SELECT trope, count(*)::int AS n FROM trope_votes WHERE book_id=$1 GROUP BY trope ORDER BY n DESC, trope`, [bookId]);

export const reactionTally = async (bookId: number) => {
  const rows = await q(`SELECT kind, count(*)::int AS n FROM reactions WHERE book_id=$1 GROUP BY kind`, [bookId]);
  return Object.fromEntries(rows.map((r) => [r.kind, r.n])) as Record<string, number>;
};

export const approvedComments = (target: { bookId?: number; listId?: number }) =>
  q(`SELECT c.id, c.body, c.spoiler, c.created_at, m.name FROM comments c JOIN commenters m ON m.id=c.commenter_id
     WHERE c.status='approved' AND ${target.bookId ? 'c.book_id=$1' : 'c.list_id=$1'} ORDER BY c.created_at ASC`,
    [target.bookId ?? target.listId]);

export const recentActivity = () =>
  q(`SELECT c.body, c.spoiler, c.created_at, m.name, b.title, b.slug, b.cover_url FROM comments c
     JOIN commenters m ON m.id=c.commenter_id JOIN books b ON b.id=c.book_id
     WHERE c.status='approved' AND NOT c.spoiler ORDER BY c.created_at DESC LIMIT 4`);

export const similarBooks = (bookId: number, tropes: string[]) =>
  q<Book & { shared: number }>(`SELECT b.*, (SELECT count(*)::int FROM unnest(b.tropes) t WHERE t = ANY($2::text[])) AS shared
     FROM books b WHERE b.id <> $1 AND b.status='published' AND b.deleted_at IS NULL
     ORDER BY shared DESC, b.featured DESC, b.created_at DESC LIMIT 6`, [bookId, tropes]);

export const topTropes = () =>
  q<{ trope: string; n: number }>(`SELECT t AS trope, count(*)::int AS n FROM books b, unnest(b.tropes) t
     WHERE b.status='published' AND b.deleted_at IS NULL GROUP BY t ORDER BY n DESC, t LIMIT 14`);

export const siteCounts = async () => (await one(`SELECT (SELECT count(*)::int FROM books WHERE status='published' AND deleted_at IS NULL) AS books,
   (SELECT count(*)::int FROM lists WHERE status='published' AND deleted_at IS NULL) AS lists,
   (SELECT count(*)::int FROM ratings) + (SELECT count(*)::int FROM comments WHERE status='approved') AS voices`))!;

export const SPICE = ['', 'Closed door', 'Mild', 'Steamy', 'Explicit', 'Explicit and plentiful'];
export const DARK = ['', 'Dark-ish', 'Morally grey', 'Dark', 'Very dark', 'Pitch black'];

// Trope pages and search. Only the site's own trope tags (books.tropes) get pages; reader-added votes don't.
export const allTropes = () =>
  q<{ trope: string; n: number }>(`SELECT t AS trope, count(*)::int AS n FROM books b, unnest(b.tropes) t
     WHERE b.status='published' AND b.deleted_at IS NULL GROUP BY t ORDER BY n DESC, t`);

export const booksWithTrope = (trope: string) =>
  q<Book>(`SELECT * FROM books WHERE $1 = ANY(tropes) AND status='published' AND deleted_at IS NULL
     ORDER BY featured DESC, created_at DESC`, [trope]);

export const searchBooks = (term: string) => {
  const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return q<Book>(`SELECT * FROM books b WHERE b.status='published' AND b.deleted_at IS NULL AND (
       b.title ILIKE $1 OR b.author ILIKE $1 OR coalesce(b.series,'') ILIKE $1
       OR EXISTS (SELECT 1 FROM unnest(b.tropes) t WHERE t ILIKE $1))
     ORDER BY (b.title ILIKE $1) DESC, (b.author ILIKE $1) DESC, b.featured DESC, b.created_at DESC LIMIT 40`, [like]);
};

export interface Rec { id: number; section: string; section_note: string; position: number; title: string; author: string; reason: string;
  asin: string | null; isbn: string | null; cover_url: string | null; linked_slug: string | null; linked_cover: string | null }

/** Curated "books like X" recommendations, grouped by section in display order. */
export async function recsForBook(bookId: number) {
  const rows = await q<Rec>(`SELECT r.*, b.slug AS linked_slug, b.cover_url AS linked_cover FROM book_recs r
     LEFT JOIN books b ON b.id=r.linked_book_id AND b.status='published' AND b.deleted_at IS NULL
     WHERE r.book_id=$1 ORDER BY r.position, r.id`, [bookId]);
  const sections: { heading: string; note: string; recs: Rec[] }[] = [];
  for (const r of rows) {
    let s = sections.find((x) => x.heading === r.section);
    if (!s) sections.push(s = { heading: r.section, note: r.section_note, recs: [] });
    s.recs.push(r);
  }
  return { sections, count: rows.length };
}

/** Curated guide pages at /best/<slug>. */
export async function guideBySlug(slug: string) {
  const g = await one<any>(`SELECT * FROM guides WHERE slug=$1 AND status='published'`, [slug]);
  if (!g) return null;
  const rows = await q<Rec>(`SELECT r.*, b.slug AS linked_slug, b.cover_url AS linked_cover FROM guide_items r
     LEFT JOIN books b ON b.id=r.linked_book_id AND b.status='published' AND b.deleted_at IS NULL
     WHERE r.guide_id=$1 ORDER BY r.position, r.id`, [g.id]);
  const sections: { heading: string; note: string; recs: Rec[] }[] = [];
  for (const r of rows) {
    let s = sections.find((x) => x.heading === r.section);
    if (!s) sections.push(s = { heading: r.section, note: r.section_note, recs: [] });
    s.recs.push(r);
  }
  return { guide: g, sections, count: rows.length };
}

export const allGuides = () =>
  q<any>(`SELECT g.slug, g.h1, g.description, g.related_trope, g.updated_at, (SELECT count(*)::int FROM guide_items i WHERE i.guide_id=g.id) AS n,
     (SELECT coalesce(b.cover_url, i.cover_url) FROM guide_items i LEFT JOIN books b ON b.id=i.linked_book_id WHERE i.guide_id=g.id ORDER BY i.position LIMIT 1) AS cover
     FROM guides g WHERE g.status='published' ORDER BY g.updated_at DESC`);

export const guidesForTrope = (trope: string) =>
  q<any>(`SELECT slug, h1 FROM guides WHERE status='published' AND related_trope=$1 ORDER BY updated_at DESC`, [trope]);
