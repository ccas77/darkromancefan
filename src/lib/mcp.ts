// The Claude admin connector. Every tool goes through the same rules as the admin page.
// Balanced mode: Claude may approve clean comments, remove obvious spam and make small edits.
// Borderline comments, new lists and new books go to the owner's approval queue. Nothing is ever sent to subscribers.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { q, one, audit } from './db';
import { approveComment, rejectComment, restoreComment, requestApproval, setBan, PolicyError } from './actions';
import { newsletterConfigured, createDraft, subscribe, PROVIDER } from './newsletter';
import { slugify } from './util';

const ACTOR = 'claude';
const ok = (data: any) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

function wrap<A>(fn: (a: A) => Promise<any>) {
  return async (a: A) => {
    try { return ok(await fn(a)); }
    catch (e: any) { if (e instanceof PolicyError) return fail(e.message); throw e; }
  };
}

export const POLICY = `Balanced rules for Claude on darkromancefan.com:
- Approve comments that are clean (no flags, no open reports) and on topic.
- Mark obvious spam as spam. Reject clearly abusive or off-topic comments.
- Anything borderline (flagged, reported, harsh but maybe legitimate, possible personal info, unmarked big spoilers) goes to the owner with escalate_comment.
- Small edits to existing books and lists (typos, blurbs, tropes, ISBN/ASIN, notes, adding published books to lists) are fine.
- New books and new lists are created as drafts and wait for the owner's approval before they go live.
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
    description: "Send a borderline comment to the owner's approval queue with a one-line explanation.",
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
    description: 'Ban a commenter who has posted spam. Refused if they have no spam on record: escalate their comment instead.',
    inputSchema: { commenter_id: z.number().int(), reason: z.string().max(300) },
  }, wrap(async ({ commenter_id, reason }: any) => {
    const r = await one(`SELECT count(*)::int AS n FROM comments WHERE commenter_id=$1 AND status='spam'`, [commenter_id]);
    if (!r!.n) throw new PolicyError('This commenter has no comments marked as spam, so banning them is the owner\'s call. Escalate their comment instead.');
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
    description: "Add a new book as a draft and send it to the owner's approval queue. Write the blurb in your own words (never copy publisher copy). Only include facts you have checked. For cover_url use Open Library: https://covers.openlibrary.org/b/id/<cover_i>-L.jpg from openlibrary.org/search.json.",
    inputSchema: bookFields,
  }, wrap(async (a: any) => {
    let slug = slugify(a.title); if (await one(`SELECT 1 FROM books WHERE slug=$1`, [slug])) slug = slugify(`${a.title} ${a.author}`);
    const note = a.content_note ?? "Dark romance with themes many readers find disturbing. Check the author's own content warnings before you start.";
    const b = await one(`INSERT INTO books (slug,title,author,series,blurb,tropes,content_note,isbn,asin,cover_url,year) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, slug`,
      [slug, a.title, a.author, a.series ?? null, a.blurb, a.tropes.map((t: string) => t.toLowerCase()), note, a.isbn ?? null, a.asin ?? null, a.cover_url ?? null, a.year ?? null]);
    await audit(ACTOR, 'create_book_draft', `book:${b!.id}`, a.title);
    const ap = await requestApproval('book', b!.id, `New book: ${a.title} by ${a.author}`, ACTOR);
    return `Draft book "${a.title}" created (slug ${b!.slug}). Waiting for owner approval #${ap}.`;
  }));

  s.registerTool('update_book', {
    description: 'Small edits to an existing book: typos, blurb, tropes, series, content note, ISBN/ASIN. Cannot change publish status.',
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

  s.registerTool('list_lists', {
    description: 'All reading lists (published and drafts) with their books.',
    inputSchema: {},
  }, wrap(async () => q(`SELECT l.id, l.slug, l.title, l.status, l.intro,
      coalesce((SELECT json_agg(json_build_object('slug', b.slug, 'title', b.title, 'position', i.position, 'note', i.note) ORDER BY i.position)
        FROM list_items i JOIN books b ON b.id=i.book_id WHERE i.list_id=l.id), '[]') AS books
      FROM lists l WHERE l.deleted_at IS NULL ORDER BY l.created_at`)));

  s.registerTool('create_list', {
    description: "Create a new reading list as a draft and send it to the owner's approval queue. Books must already exist (create_book first).",
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
    await audit(ACTOR, 'create_list_draft', `list:${l!.id}`, title);
    const ap = await requestApproval('list', l!.id, `New list: ${title} (${pos} books)`, ACTOR);
    return { message: `Draft list created, waiting for owner approval #${ap}.`, slug, missing_books: missing };
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
      if (b.status !== 'published' && l.status === 'published') throw new PolicyError(`${x.book_slug} is still a draft waiting for the owner, so it can't go on a live list yet.`);
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
