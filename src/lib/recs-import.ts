// Content imports for "Books like X". Each JSON file in src/data/recs is named after a book slug and carries a
// "version". A file is imported when its version is higher than the one last imported for that book, replacing
// that book's recommendations. Day-to-day changes go through the connector's set_book_recs tool.
const files = import.meta.glob('../data/recs/*.json', { eager: true, import: 'default' }) as Record<string, any>;

type Run = (text: string, params?: any[]) => Promise<Record<string, any>[]>;

export async function importRecs(run: Run) {
  for (const [path, data] of Object.entries(files)) {
    const slug = path.split('/').pop()!.replace(/\.json$/, '');
    const version = Number(data.version) || 1;
    const [b] = await run(`SELECT id, recs_version FROM books WHERE slug=$1 AND deleted_at IS NULL`, [slug]);
    if (!b) continue;
    if (b.recs_version >= version) continue;
    // Claim the import first, so two server instances starting at once can't both run it.
    const [claimed] = await run(`UPDATE books SET recs_version=$2 WHERE id=$1 AND recs_version < $2 RETURNING id`, [b.id, version]);
    if (!claimed) continue;
    await run(`DELETE FROM book_recs WHERE book_id=$1`, [b.id]);
    let pos = 0;
    for (const sec of data.sections) for (const r of sec.recs) {
      const [lb] = r.linked_slug ? await run(`SELECT id FROM books WHERE slug=$1 AND deleted_at IS NULL`, [r.linked_slug]) : [];
      await run(`INSERT INTO book_recs (book_id, section, section_note, position, title, author, reason, linked_book_id, asin, isbn, cover_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [b.id, sec.heading, sec.note ?? '', pos++, r.title, r.author, r.reason, lb?.id ?? null, r.asin ?? null, r.isbn ?? null, r.cover_url ?? null]);
    }
    if (data.intro) await run(`UPDATE books SET recs_intro=$2 WHERE id=$1`, [b.id, data.intro]);
    await run(`INSERT INTO audit_log (actor, action, target, details) VALUES ('claude','import_book_recs',$1,$2)`, [`book:${b.id}`, `${pos} recommendations`]);
  }
}
