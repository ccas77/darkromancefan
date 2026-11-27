// The Claude admin connector. Every tool goes through the same rules as the admin page.
// Hands-off mode: Claude publishes books and lists and moderates comments itself; the owner can undo from /admin.
// Nothing is ever sent to subscribers, and money stays with the owner.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { q, one, audit } from './db';
import { approveComment, rejectComment, restoreComment, requestApproval, setBan, PolicyError } from './actions';
import { newsletterConfigured, createDraft, updateDraft, subscribe, PROVIDER } from './newsletter';
import { slugify } from './util';
import { saveGuide } from './recs-import';

const ACTOR = 'claude';
const ok = (data: any) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

function wrap<A>(fn: (a: A) => Promise<any>) {
  return async (a: A) => {
    try { return ok(await fn(a)); }
    catch (e: any) { if (e instanceof PolicyError) return fail(e.message); throw e; }
  };
}

export const POLICY = `Hands-off rules for Claude on darkromancefan.com (chosen by the owner on 27 Nov 2026):
- Claude runs content and moderation without asking. The owner gets a daily summary and can unpublish or remove anything from the admin page.
- Comments: approve anything on topic, including flagged or reported comments once you have judged them fine. Reject abusive or off-topic comments, mark spam, ban spammers and abusive repeat offenders. This is a dark romance site for adults: dark themes, spice and strong opinions are fine.
- Only escalate_comment for a real legal risk: someone's personal details, a threat against a real person, or a defamatory claim about a real person.
- Books, lists and "Books like X" sections go live straight away. Facts and covers must be checked first (see the tool descriptions).
- Newsletter issues are drafts only. The owner reviews and sends them. Never tell readers or authors something was sent.
- Refunds and payments are the owner's. If a promo booking isn't a fit, set it to needs_owner with a note.
- Every action is logged.`;

function mdToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return md.split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (/^#{1,3} /.test(b)) { const n = b.match(/^#+/)![0].length; return `<h${n}>${inline(b.replace(/^#+ /, ''))}</h${n}>`; }
    if (/^[-*] /m.test(b)) return '<ul>' + b.split('\n').map((l) => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('') + '</ul>';
    return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

export function buildServer() {
  const s = new McpServer({ name: 'darkromancefan-admin', version: '1.0.0' }, { instructions: POLICY });

  s.registerTool('get_overview', {
    description: 'Start here. Shows what needs attention (comment queue, reports, suggestions, new bookings, owner approvals) plus headline numbers and the rules Claude must follow.',
    inputSchema: {},
  }, wrap(async () => {
    const r = await one(`SELECT
      (SELECT count(*)::int FROM comments WHERE status='pending') AS comments_pending,
      (SELECT count(*)::int FROM comments WHERE status='flagged') AS comments_flagged,
      (SELECT count(*)::int FROM reports WHERE NOT resolved) AS open_reports,
      (SELECT count(*)::int FROM suggestions WHERE status='pending') AS suggestions_pending,
      (SELECT count(*)::int FROM promo_bookings WHERE status='new') AS new_bookings,
      (SELECT count(*)::int FROM approvals WHERE status='pending') AS waiting_for_owner,
      (SELECT count(*)::int FROM signups) AS subscribers_via_site,
      (SELECT count(*)::int FROM comments WHERE status='approved') AS live_comments,
      (SELECT count(*)::int FROM clicks WHERE created_at > now()-interval '7 days') AS buy_clicks_7d`);
    return { ...r, newsletter_provider: PROVIDER, newsletter_connected: newsletterConfigured(),
      unsynced_signups: (await one(`SELECT count(*)::int AS n FROM signups WHERE NOT synced`))!.n, rules: POLICY };
  }));

  // ---------- Moderation ----------
  s.registerTool('list_comment_queue', {
    description: 'Comments waiting for a decision (pending first-timers and auto-flagged ones), with flags and report counts.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
  }, wrap(async ({ limit }: any) => q(`SELECT c.id, c.status, c.flags, c.body, c.spoiler, c.created_at, m.id AS commenter_id, m.name, m.trusted,
      b.title AS book, l.title AS list, (SELECT count(*)::int FROM reports r WHERE r.comment_id=c.id AND NOT r.resolved) AS open_reports,
      (SELECT count(*)::int FROM comments x WHERE x.commenter_id=m.id AND x.status='spam') AS commenter_spam_count
      FROM comments c JOIN commenters m ON m.id=c.commenter_id LEFT JOIN books b ON b.id=c.book_id LEFT JOIN lists l ON l.id=c.list_id
      WHERE c.status IN ('pending','flagged') OR c.id IN (SELECT comment_id FROM reports WHERE NOT resolved)
      ORDER BY c.created_at LIMIT $1`, [limit])));

  s.registerTool('approve_comment', {
    description: 'Publish a clean comment. Refused for flagged or reported comments: escalate those instead. Approving also trusts the commenter so their future comments post straight away.',
    inputSchema: { comment_id: z.number().int() },
  }, wrap(async ({ comment_id }: any) => { await approveComment(comment_id, ACTOR); return `Comment ${comment_id} approved and live.`; }));

  s.registerTool('reject_comment', {
    description: 'Hide a comment. Use as_spam=true for obvious spam. Soft: it can be restored.',
    inputSchema: { comment_id: z.number().int(), as_spam: z.boolean().default(false), reason: z.string().max(300).default('') },
  }, wrap(async ({ comment_id, as_spam, reason }: any) => { await rejectComment(comment_id, ACTOR, as_spam ? 'spam' : 'rejected', reason); return `Comment ${comment_id} ${as_spam ? 'marked as spam' : 'rejected'}.`; }));

  s.registerTool('escalate_comment', {
    description: "Only for a real legal risk (personal details, a threat or a defamatory claim about a real person): hide the comment and send it to the owner with a one-line explanation. Everything else you decide yourself.",
    inputSchema: { comment_id: z.number().int(), reason: z.string().min(3).max(300) },
  }, wrap(async ({ comment_id, reason }: any) => {
    const c = await one(`SELECT c.body, m.name FROM comments c JOIN commenters m ON m.id=c.commenter_id WHERE c.id=$1`, [comment_id]);
    if (!c) throw new PolicyError('Comment not found');
    const id = await requestApproval('comment', comment_id, `Comment by ${c.name}: "${c.body.slice(0, 140)}" (${reason})`, ACTOR);
    return `Sent to the owner (approval #${id}).`;
  }));

  s.registerTool('restore_comment', {
    description: 'Undo a rejection: puts a comment back in the queue.',
    inputSchema: { comment_id: z.number().int() },
  }, wrap(async ({ comment_id }: any) => { await restoreComment(comment_id, ACTOR); return `Comment ${comment_id} is back in the queue.`; }));

  s.registerTool('ban_commenter', {
    description: 'Ban a spammer or an abusive repeat offender. Their pending comments are removed. Give a short reason.',
    inputSchema: { commenter_id: z.number().int(), reason: z.string().max(300) },
  }, wrap(async ({ commenter_id, reason }: any) => {
    await setBan(commenter_id, true, ACTOR); await audit(ACTOR, 'ban_reason', `commenter:${commenter_id}`, reason);
    return `Commenter ${commenter_id} banned.`;
  }));

  // ---------- Content ----------
  s.registerTool('search_books', {
    description: 'Find books by title, author or trope. Includes drafts.',
    inputSchema: { query: z.string().default('') },
  }, wrap(async ({ query }: any) => q(`SELECT id, slug, title, author, series, tropes, status, isbn, asin, featured FROM books
      WHERE deleted_at IS NULL AND ($1='' OR title ILIKE '%'||$1||'%' OR author ILIKE '%'||$1||'%' OR $1 = ANY(tropes)) ORDER BY title LIMIT 50`, [query])));

  s.registerTool('get_book', {
    description: 'Full details for one book, including reader ratings, trope votes, reactions and the lists it is on.',
    inputSchema: { slug: z.string() },
  }, wrap(async ({ slug }: any) => {
    const b = await one(`SELECT * FROM books WHERE slug=$1 AND deleted_at IS NULL`, [slug]);
    if (!b) throw new PolicyError('Book not found');
    const [ratings, tropes, reactions, lists, clicks] = await Promise.all([
      one(`SELECT count(*)::int AS n, round(avg(overall),1)::float AS overall, round(avg(spice),1)::float AS spice, round(avg(darkness),1)::float AS darkness FROM ratings WHERE book_id=$1`, [b.id]),
      q(`SELECT trope, count(*)::int AS votes FROM trope_votes WHERE book_id=$1 GROUP BY trope ORDER BY votes DESC`, [b.id]),
      q(`SELECT kind, count(*)::int AS n FROM reactions WHERE book_id=$1 GROUP BY kind`, [b.id]),
      q(`SELECT l.slug, l.title FROM list_items i JOIN lists l ON l.id=i.list_id WHERE i.book_id=$1`, [b.id]),
      q(`SELECT store, count(*)::int AS n FROM clicks WHERE book_id=$1 GROUP BY store`, [b.id]),
    ]);
    return { ...b, ratings, trope_votes: tropes, reactions, lists, clicks };
  }));

  const bookFields = {
    title: z.string().min(1).max(200), author: z.string().min(1).max(120), series: z.string().max(120).nullable().optional(),
    blurb: z.string().max(600), tropes: z.array(z.string().max(40)).max(12), content_note: z.string().max(600).optional(),
    isbn: z.string().regex(/^\d{10}(\d{3})?$/).nullable().optional(), asin: z.string().regex(/^[A-Z0-9]{10}$/).nullable().optional(),
    cover_url: z.string().url().nullable().optional(), year: z.number().int().min(1900).max(2100).nullable().optional(),
  };

  s.registerTool('create_book', {
    description: "Add a new book. It goes live straight away, so check every fact and the cover first. Write the blurb in your own words (never copy publisher copy). Only include facts you have checked. For cover_url use Open Library: https://covers.openlibrary.org/b/id/<cover_i>-L.jpg from openlibrary.org/search.json. COVERS: never trust Open Library's first result (it often picks a foreign or omnibus edition). Download the image and look at it before using it: it must be the English edition of this exact book (right title, author, series number). Prefer the edition matching the ISBN via openlibrary.org/works/<id>/editions.json; if none is right, save the correct cover (e.g. from the Goodreads book page) as public/covers/books/<slug>.jpg in the repo (max 600px wide) and use https://www.darkromancefan.com/covers/books/<slug>.jpg.",
    inputSchema: bookFields,
  }, wrap(async (a: any) => {
    let slug = slugify(a.title); if (await one(`SELECT 1 FROM books WHERE slug=$1`, [slug])) slug = slugify(`${a.title} ${a.author}`);
    const note = a.content_note ?? '';
    const b = await one(`INSERT INTO books (slug,title,author,series,blurb,tropes,content_note,isbn,asin,cover_url,year) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, slug`,
      [slug, a.title, a.author, a.series ?? null, a.blurb, a.tropes.map((t: string) => t.toLowerCase()), note, a.isbn ?? null, a.asin ?? null, a.cover_url ?? null, a.year ?? null]);
    await q(`UPDATE books SET status='published', updated_at=now() WHERE id=$1`, [b!.id]);
    await audit(ACTOR, 'publish_book', `book:${b!.id}`, `${a.title} by ${a.author}`);
    return `Book "${a.title}" is live at /books/${b!.slug}.`;
  }));

  s.registerTool('update_book', {
    description: 'Small edits to an existing book: typos, blurb, tropes, series, content note, ISBN/ASIN. Cannot change publish status. Content notes are only for specific, useful facts a dark romance reader would want (e.g. on-page SA, cheating, no HEA, cliffhanger); never generic disclaimers.',
    inputSchema: { slug: z.string(), changes: z.object(bookFields).partial() },
  }, wrap(async ({ slug, changes }: any) => {
    const b = await one(`SELECT * FROM books WHERE slug=$1 AND deleted_at IS NULL`, [slug]);
    if (!b) throw new PolicyError('Book not found');
    const keys = Object.keys(changes).filter((k) => k in bookFields);
    if (!keys.length) throw new PolicyError('Nothing to change');
    const before = Object.fromEntries(keys.map((k) => [k, b[k]]));
    const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
    await q(`UPDATE books SET ${sets}, updated_at=now() WHERE id=$1`, [b.id, ...keys.map((k) => k === 'tropes' ? changes[k].map((t: string) => t.toLowerCase()) : changes[k])]);
    await audit(ACTOR, 'update_book', `book:${b.id}`, { before, after: changes });
    return `Updated ${b.title}: ${keys.join(', ')}.`;
  }));

  s.registerTool('get_book_recs', {
    description: 'The "Books like X" recommendations currently on a book page, by section.',
    inputSchema: { slug: z.string() },
  }, wrap(async ({ slug }: any) => {
    const b = await one(`SELECT id, title, recs_intro FROM books WHERE slug=$1 AND deleted_at IS NULL`, [slug]);
    if (!b) throw new PolicyError('Book not found');
    const rows = await q(`SELECT r.section, r.section_note, r.title, r.author, r.reason, r.asin, r.isbn, r.cover_url, lb.slug AS linked_slug,
        (SELECT count(*)::int FROM clicks c WHERE c.rec_id=r.id) AS clicks
      FROM book_recs r LEFT JOIN books lb ON lb.id=r.linked_book_id WHERE r.book_id=$1 ORDER BY r.position, r.id`, [b.id]);
    return { book: b.title, intro: b.recs_intro, recs: rows };
  }));

  s.registerTool('set_book_recs', {
    description: `Replace the "Books like X" section on a book page (a small edit: live straight away). This section is how the site wins long-tail searches such as "books like Haunting Adeline but less dark", "MM books like ...", "sapphic books like ...", so name each section after a real search phrase, e.g. "Books like Haunting Adeline but less dark". Rules: every rec must be a real, published book you have checked (title, author, what happens). Write reasons in your own words, one or two sentences, saying why a fan of this book would like it; never copy blurbs or reviews. Go beyond the usual BookTok titles: mix well-known picks with lesser-known ones. Don't claim Kindle Unlimited or audiobook availability unless you checked it today. Use linked_slug when the book has a page on this site. asin = the English Kindle or print ASIN if known (else isbn, else a search link is used). cover_url: an Open Library cover (https://covers.openlibrary.org/b/id/<id>-L.jpg) or one saved on the site. COVERS: never trust Open Library's first result (it often picks a foreign or omnibus edition). Download the image and look at it before using it: it must be the English edition of this exact book (right title, author, series number). Prefer the edition matching the ISBN via openlibrary.org/works/<id>/editions.json; if none is right, save the correct cover (e.g. from the Goodreads book page) as public/covers/books/<slug>.jpg in the repo (max 600px wide) and use https://www.darkromancefan.com/covers/books/<slug>.jpg.`,
    inputSchema: {
      slug: z.string(),
      intro: z.string().max(600).optional(),
      sections: z.array(z.object({
        heading: z.string().min(5).max(120),
        note: z.string().max(300).optional(),
        recs: z.array(z.object({
          title: z.string().min(1).max(200), author: z.string().min(1).max(150), reason: z.string().min(20).max(400),
          linked_slug: z.string().optional(), asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(), isbn: z.string().regex(/^[0-9X]{10,13}$/).optional(),
          cover_url: z.string().url().optional(),
        })).min(1).max(15),
      })).min(1).max(10),
    },
  }, wrap(async ({ slug, intro, sections }: any) => {
    const b = await one(`SELECT id, title FROM books WHERE slug=$1 AND deleted_at IS NULL`, [slug]);
    if (!b) throw new PolicyError('Book not found');
    const before = await one(`SELECT count(*)::int AS n FROM book_recs WHERE book_id=$1`, [b.id]);
    await q(`DELETE FROM book_recs WHERE book_id=$1`, [b.id]);
    let pos = 0; const unlinked: string[] = [];
    for (const sec of sections) for (const r of sec.recs) {
      let linked: number | null = null;
      if (r.linked_slug) {
        const lb = await one(`SELECT id FROM books WHERE slug=$1 AND deleted_at IS NULL`, [r.linked_slug]);
        if (lb) linked = lb.id; else unlinked.push(r.linked_slug);
      }
      await q(`INSERT INTO book_recs (book_id, section, section_note, position, title, author, reason, linked_book_id, asin, isbn, cover_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [b.id, sec.heading, sec.note ?? '', pos++, r.title, r.author, r.reason, linked, r.asin ?? null, r.isbn ?? null, r.cover_url ?? null]);
    }
    if (intro !== undefined) await q(`UPDATE books SET recs_intro=$2, updated_at=now() WHERE id=$1`, [b.id, intro]);
    await audit(ACTOR, 'set_book_recs', `book:${b.id}`, { before: before?.n ?? 0, after: pos, sections: sections.map((x: any) => x.heading) });
    return `Saved ${pos} recommendations in ${sections.length} sections for ${b.title}.` + (unlinked.length ? ` Not linked (no such book): ${unlinked.join(', ')}.` : '');
  }));

  const recItem = z.object({
    title: z.string().min(1).max(200), author: z.string().min(1).max(150), reason: z.string().min(20).max(400),
    linked_slug: z.string().optional(), asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(), isbn: z.string().regex(/^[0-9X]{10,13}$/).optional(),
    cover_url: z.string().url().optional(),
  });

  s.registerTool('list_guides', {
    description: 'All /best guide pages (curated long-tail landing pages) with their target keywords and book counts.',
    inputSchema: {},
  }, wrap(async () => q(`SELECT g.slug, g.h1, g.title, g.keywords, g.related_trope, g.updated_at,
      (SELECT count(*)::int FROM guide_items i WHERE i.guide_id=g.id) AS books,
      (SELECT count(*)::int FROM clicks c JOIN guide_items i ON i.id=c.guide_item_id WHERE i.guide_id=g.id) AS clicks
      FROM guides g ORDER BY g.updated_at DESC`)));

  s.registerTool('get_guide', {
    description: 'One /best guide page in full: fields, FAQ and every book by section.',
    inputSchema: { slug: z.string() },
  }, wrap(async ({ slug }: any) => {
    const g = await one(`SELECT * FROM guides WHERE slug=$1`, [slug]);
    if (!g) throw new PolicyError('Guide not found');
    const items = await q(`SELECT i.section, i.section_note, i.title, i.author, i.reason, i.asin, i.isbn, i.cover_url, b.slug AS linked_slug
      FROM guide_items i LEFT JOIN books b ON b.id=i.linked_book_id WHERE i.guide_id=$1 ORDER BY i.position`, [g.id]);
    return { ...g, items };
  }));

  s.registerTool('set_guide', {
    description: `Create or replace a /best/<slug> guide page. It goes live straight away. Guides target ONE long-tail search cluster from keyword research (e.g. "hitman romance books", "dark romance where he kidnaps her"); put the exact phrases in keywords. The slug is the main keyword (e.g. "hitman-romance-books"). title (<= 65 chars, starts with the keyword, e.g. "Hitman Romance Books: 24 Dark Picks Beyond the BookTok Lists"), h1 (natural phrase with the keyword), description (140-160 chars). intro: 2-3 sentences that answer the search straight away. sections: 3-7, each heading a real modifier people search ("...with a happy ending", "MM ...", "... standalones", "less dark ..."). 15-30 books. faq: 3-6 questions people actually ask (use autocomplete "how/what/is" phrasings), answered in 1-3 sentences from facts you checked. Same accuracy and cover rules as set_book_recs: every book real and checked, reasons in your own words, look at every cover before using it (English edition of that exact book). Never claim Kindle Unlimited or audiobook availability.`,
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9-]{3,80}$/), title: z.string().min(20).max(70), h1: z.string().min(5).max(120),
      description: z.string().min(80).max(170), intro: z.string().min(60).max(700),
      keywords: z.array(z.string().max(100)).min(1).max(30), related_trope: z.string().max(40).optional(),
      faq: z.array(z.object({ q: z.string().min(8).max(160), a: z.string().min(20).max(600) })).max(8).optional(),
      sections: z.array(z.object({ heading: z.string().min(5).max(120), note: z.string().max(300).optional(), recs: z.array(recItem).min(2).max(15) })).min(2).max(8),
    },
  }, wrap(async (g: any) => {
    await q(`INSERT INTO guides (slug, title, h1, description) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`, [g.slug, g.title, g.h1, g.description]);
    const row = await one(`SELECT id FROM guides WHERE slug=$1`, [g.slug]);
    const n = await saveGuide(q as any, row!.id, g);
    await audit(ACTOR, 'set_guide', `guide:${row!.id}`, `${g.h1} (${n} books)`);
    return `Guide live at /best/${g.slug} with ${n} books.`;
  }));

  s.registerTool('unpublish_guide', {
    description: 'Take a guide page off the site (keeps it in the database).',
    inputSchema: { slug: z.string() },
  }, wrap(async ({ slug }: any) => { await q(`UPDATE guides SET status='draft' WHERE slug=$1`, [slug]); await audit(ACTOR, 'unpublish_guide', slug); return 'Unpublished.'; }));

  s.registerTool('list_lists', {
    description: 'All reading lists (published and drafts) with their books.',
    inputSchema: {},
  }, wrap(async () => q(`SELECT l.id, l.slug, l.title, l.status, l.intro,
      coalesce((SELECT json_agg(json_build_object('slug', b.slug, 'title', b.title, 'position', i.position, 'note', i.note) ORDER BY i.position)
        FROM list_items i JOIN books b ON b.id=i.book_id WHERE i.list_id=l.id), '[]') AS books
      FROM lists l WHERE l.deleted_at IS NULL ORDER BY l.created_at`)));

  s.registerTool('create_list', {
    description: "Create a new reading list. It goes live straight away. Books must already exist (create_book first).",
    inputSchema: { title: z.string().min(5).max(150), intro: z.string().max(800), book_slugs: z.array(z.string()).min(1).max(40) },
  }, wrap(async ({ title, intro, book_slugs }: any) => {
    const slug = slugify(title);
    if (await one(`SELECT 1 FROM lists WHERE slug=$1`, [slug])) throw new PolicyError('A list with that title already exists');
    const l = await one(`INSERT INTO lists (slug,title,intro) VALUES ($1,$2,$3) RETURNING id`, [slug, title, intro]);
    let pos = 0; const missing: string[] = [];
    for (const bs of book_slugs) {
      const b = await one(`SELECT id FROM books WHERE slug=$1 AND deleted_at IS NULL`, [bs]);
      if (b) await q(`INSERT INTO list_items (list_id,book_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [l!.id, b.id, pos++]); else missing.push(bs);
    }
    await q(`UPDATE lists SET status='published', updated_at=now() WHERE id=$1`, [l!.id]);
    await audit(ACTOR, 'publish_list', `list:${l!.id}`, `${title} (${pos} books)`);
    return { message: `List is live at /lists/${slug}.`, slug, missing_books: missing };
  }));

  s.registerTool('update_list', {
    description: 'Small edits to a list: title or intro wording, add a published book, remove a book, reorder, or change a book note.',
    inputSchema: {
      slug: z.string(), title: z.string().max(150).optional(), intro: z.string().max(800).optional(),
      add: z.array(z.object({ book_slug: z.string(), position: z.number().int().optional(), note: z.string().max(300).optional() })).optional(),
      remove: z.array(z.string()).optional(),
      notes: z.array(z.object({ book_slug: z.string(), note: z.string().max(300) })).optional(),
    },
  }, wrap(async (a: any) => {
    const l = await one(`SELECT * FROM lists WHERE slug=$1 AND deleted_at IS NULL`, [a.slug]);
    if (!l) throw new PolicyError('List not found');
    const done: string[] = [];
    if (a.title || a.intro) { await q(`UPDATE lists SET title=coalesce($2,title), intro=coalesce($3,intro), updated_at=now() WHERE id=$1`, [l.id, a.title ?? null, a.intro ?? null]); done.push('wording'); }
    for (const x of a.add ?? []) {
      const b = await one(`SELECT id, status FROM books WHERE slug=$1 AND deleted_at IS NULL`, [x.book_slug]);
      if (!b) throw new PolicyError(`Book ${x.book_slug} not found`);
      if (b.status !== 'published' && l.status === 'published') throw new PolicyError(`${x.book_slug} is not published, so it can't go on a live list.`);
      const pos = x.position ?? (await one(`SELECT coalesce(max(position)+1,0)::int AS p FROM list_items WHERE list_id=$1`, [l.id]))!.p;
      await q(`INSERT INTO list_items (list_id,book_id,position,note) VALUES ($1,$2,$3,$4) ON CONFLICT (list_id,book_id) DO UPDATE SET position=$3, note=$4`, [l.id, b.id, pos, x.note ?? '']);
      done.push(`added ${x.book_slug}`);
    }
    for (const bs of a.remove ?? []) {
      const r = await one(`DELETE FROM list_items WHERE list_id=$1 AND book_id=(SELECT id FROM books WHERE slug=$2) RETURNING position, note`, [l.id, bs]);
      if (r) done.push(`removed ${bs} (was position ${r.position})`);
    }
    for (const n of a.notes ?? []) { await q(`UPDATE list_items SET note=$3 WHERE list_id=$1 AND book_id=(SELECT id FROM books WHERE slug=$2)`, [l.id, n.book_slug, n.note]); done.push(`note on ${n.book_slug}`); }
    await q(`UPDATE lists SET updated_at=now() WHERE id=$1`, [l.id]);
    await audit(ACTOR, 'update_list', `list:${l.id}`, done.join('; '));
    return `Updated "${l.title}": ${done.join('; ') || 'no changes'}.`;
  }));

  s.registerTool('list_suggestions', {
    description: 'Book suggestions from readers waiting for review.',
    inputSchema: {},
  }, wrap(async () => q(`SELECT s.id, s.title, s.author, s.note, s.created_at, l.slug AS list_slug, l.title AS list_title,
      (SELECT count(*)::int FROM suggestions x WHERE lower(x.title)=lower(s.title)) AS times_suggested
      FROM suggestions s LEFT JOIN lists l ON l.id=s.list_id WHERE s.status='pending' ORDER BY s.created_at`)));

  s.registerTool('close_suggestion', {
    description: 'Mark a reader suggestion as accepted (after you have added the book) or rejected.',
    inputSchema: { suggestion_id: z.number().int(), accepted: z.boolean() },
  }, wrap(async ({ suggestion_id, accepted }: any) => {
    await q(`UPDATE suggestions SET status=$2 WHERE id=$1`, [suggestion_id, accepted ? 'accepted' : 'rejected']);
    await audit(ACTOR, 'close_suggestion', `suggestion:${suggestion_id}`, accepted ? 'accepted' : 'rejected');
    return 'Done.';
  }));

  // ---------- Promos & newsletter ----------
  s.registerTool('list_promo_bookings', {
    description: 'Paid author promo bookings from Stripe. Filter by status: new, scheduled, needs_owner, run.',
    inputSchema: { status: z.enum(['new', 'scheduled', 'needs_owner', 'run', 'all']).default('new') },
  }, wrap(async ({ status }: any) => q(`SELECT * FROM promo_bookings WHERE ($1='all' OR status=$1) ORDER BY created_at`, [status])));

  s.registerTool('update_promo_booking', {
    description: "Schedule a booking (status scheduled, optionally with issue_id) or hand it to the owner (needs_owner) with a note, e.g. when the book isn't a fit and may need a refund. Claude cannot refund.",
    inputSchema: { booking_id: z.number().int(), status: z.enum(['scheduled', 'needs_owner']), issue_id: z.number().int().optional(), notes: z.string().max(500).default('') },
  }, wrap(async ({ booking_id, status, issue_id, notes }: any) => {
    await q(`UPDATE promo_bookings SET status=$2, issue_id=coalesce($3, issue_id), notes=$4 WHERE id=$1`, [booking_id, status, issue_id ?? null, notes]);
    if (status === 'needs_owner') await audit(ACTOR, 'booking_needs_owner', `booking:${booking_id}`, notes);
    else await audit(ACTOR, 'schedule_booking', `booking:${booking_id}`, { issue_id, notes });
    return `Booking ${booking_id} set to ${status}.`;
  }));

  s.registerTool('get_newsletter_material', {
    description: 'Everything useful for the next issue: scheduled/new bookings, recently published lists and books, top-rated books, and recent non-spoiler reader comments.',
    inputSchema: { days: z.number().int().min(1).max(60).default(7) },
  }, wrap(async ({ days }: any) => {
    const [bookings, lists, books, top, comments] = await Promise.all([
      q(`SELECT * FROM promo_bookings WHERE status IN ('new','scheduled') AND issue_id IS NULL ORDER BY created_at`),
      q(`SELECT slug, title, intro FROM lists WHERE status='published' AND deleted_at IS NULL AND updated_at > now() - ($1 || ' days')::interval`, [days]),
      q(`SELECT slug, title, author FROM books WHERE status='published' AND deleted_at IS NULL AND created_at > now() - ($1 || ' days')::interval`, [days]),
      q(`SELECT b.slug, b.title, b.author, round(avg(r.overall),1)::float AS overall, count(*)::int AS n FROM ratings r JOIN books b ON b.id=r.book_id
         GROUP BY b.id HAVING count(*) >= 3 ORDER BY overall DESC, n DESC LIMIT 5`),
      q(`SELECT c.body, m.name, b.title, b.slug FROM comments c JOIN commenters m ON m.id=c.commenter_id JOIN books b ON b.id=c.book_id
         WHERE c.status='approved' AND NOT c.spoiler AND c.body NOT LIKE '%||%' AND c.created_at > now() - ($1 || ' days')::interval ORDER BY c.created_at DESC LIMIT 10`, [days]),
    ]);
    return { site: 'https://www.darkromancefan.com', unscheduled_bookings: bookings, updated_lists: lists, new_books: books, top_rated: top, reader_comments: comments,
      tip: 'Link books as https://www.darkromancefan.com/books/<slug> so clicks are tracked on the site. Paid placements go first and are labelled "Sponsored".' };
  }));

  s.registerTool('save_newsletter_draft', {
    description: 'Save a newsletter issue as a DRAFT (markdown). Also creates a draft broadcast in Kit when connected. Never schedules or sends: the owner reviews and sends it. Pass issue_id to revise an existing draft.',
    inputSchema: { title: z.string().max(150), send_date: z.string().max(40), content_md: z.string().max(40000),
      booking_ids: z.array(z.number().int()).default([]), issue_id: z.number().int().optional() },
  }, wrap(async ({ title, send_date, content_md, booking_ids, issue_id }: any) => {
    let id = issue_id;
    if (id) {
      const cur = await one(`SELECT status FROM newsletter_issues WHERE id=$1`, [id]);
      if (!cur) throw new PolicyError('Issue not found');
      if (cur.status === 'sent') throw new PolicyError('That issue has already been sent and cannot be edited.');
      await q(`UPDATE newsletter_issues SET title=$2, send_date=$3, content_md=$4, updated_at=now() WHERE id=$1`, [id, title, send_date, content_md]);
    } else {
      id = (await one(`INSERT INTO newsletter_issues (title,send_date,content_md) VALUES ($1,$2,$3) RETURNING id`, [title, send_date, content_md]))!.id;
    }
    for (const b of booking_ids) await q(`UPDATE promo_bookings SET status='scheduled', issue_id=$2 WHERE id=$1`, [b, id]);
    let provider = 'Kit not connected: the owner can copy the draft from the admin page.';
    if (newsletterConfigured()) {
      const existing = (await one(`SELECT beehiiv_post_id AS kid FROM newsletter_issues WHERE id=$1`, [id]))?.kid;
      if (existing && /^\d+$/.test(existing)) {
        const u = await updateDraft(existing, title, mdToHtml(content_md));
        if (u.ok) { await audit(ACTOR, 'save_newsletter_draft', `issue:${id}`, title); return { issue_id: id, status: 'draft', provider: 'Existing Kit draft updated (not scheduled or sent).', html_preview: mdToHtml(content_md).slice(0, 2000) }; }
      }
      const r = await createDraft(title, mdToHtml(content_md));
      if (r.ok) { await q(`UPDATE newsletter_issues SET beehiiv_post_id=$2 WHERE id=$1`, [id, String(r.data?.broadcast?.id || 'created')]); provider = 'Draft created in Kit (not scheduled or sent).'; }
      else provider = `Kit didn't accept the draft (HTTP ${r.status}). The owner can copy it from the admin page.`;
    }
    await audit(ACTOR, 'save_newsletter_draft', `issue:${id}`, title);
    return { issue_id: id, status: 'draft', provider, html_preview: mdToHtml(content_md).slice(0, 2000) };
  }));

  s.registerTool('sync_signups_to_newsletter', {
    description: 'Send site sign-ups that are not yet in Kit (for example from before Kit was connected) to Kit, up to 200 per call. Safe to repeat.',
    inputSchema: { limit: z.number().int().min(1).max(200).default(200) },
  }, wrap(async ({ limit }: any) => {
    if (!newsletterConfigured()) throw new PolicyError('Kit is not connected yet (KIT_API_KEY missing).');
    const rows = await q(`SELECT email, source FROM signups WHERE NOT synced ORDER BY created_at LIMIT $1`, [limit]);
    let ok = 0; const failed: number[] = [];
    for (const r of rows) {
      const res = await subscribe(r.email, r.source || 'site');
      if (res.ok) { ok++; await q(`UPDATE signups SET synced=true WHERE email=$1`, [r.email]); } else failed.push(res.status);
    }
    await audit(ACTOR, 'sync_signups', 'newsletter', { synced: ok, failed: failed.length });
    const left = (await one(`SELECT count(*)::int AS n FROM signups WHERE NOT synced`))!.n;
    return { synced: ok, failed: failed.length, failure_statuses: [...new Set(failed)], still_unsynced: left };
  }));

  // ---------- Reporting ----------
  s.registerTool('get_stats', {
    description: 'Traffic-side numbers for a period: buy-link clicks by book and store, new ratings and comments, sign-ups by source, and promo revenue.',
    inputSchema: { days: z.number().int().min(1).max(365).default(7) },
  }, wrap(async ({ days }: any) => {
    const p = [days];
    const iv = `now() - ($1 || ' days')::interval`;
    const [clicks, signups, activity, revenue] = await Promise.all([
      q(`SELECT b.title, c.store, count(*)::int AS clicks FROM clicks c JOIN books b ON b.id=c.book_id WHERE c.created_at > ${iv} GROUP BY b.title, c.store ORDER BY clicks DESC LIMIT 20`, p),
      q(`SELECT source, count(*)::int AS n, sum(CASE WHEN synced THEN 1 ELSE 0 END)::int AS synced_to_newsletter FROM signups WHERE created_at > ${iv} GROUP BY source ORDER BY n DESC`, p),
      one(`SELECT (SELECT count(*)::int FROM comments WHERE status='approved' AND created_at > ${iv}) AS comments,
                  (SELECT count(*)::int FROM ratings WHERE created_at > ${iv}) AS ratings,
                  (SELECT count(*)::int FROM trope_votes WHERE created_at > ${iv}) AS trope_votes,
                  (SELECT count(*)::int FROM suggestions WHERE created_at > ${iv}) AS suggestions`, p),
      q(`SELECT package, currency, count(*)::int AS bookings, sum(amount_cents)::int AS cents FROM promo_bookings WHERE created_at > ${iv} GROUP BY package, currency`, p),
    ]);
    return { days, buy_clicks: clicks, signups, reader_activity: activity, promo_revenue: revenue,
      note: 'Page views are in Vercel Web Analytics; affiliate earnings are in the Amazon and Bookshop dashboards.' };
  }));

  s.registerTool('get_activity_log', {
    description: 'Recent actions by Claude, the owner, readers and Stripe.',
    inputSchema: { limit: z.number().int().min(1).max(200).default(50), actor: z.string().optional() },
  }, wrap(async ({ limit, actor }: any) => q(`SELECT * FROM audit_log WHERE ($2::text IS NULL OR actor=$2) ORDER BY created_at DESC LIMIT $1`, [limit, actor ?? null])));

  return s;
}
