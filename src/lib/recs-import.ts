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

const guideFiles = import.meta.glob('../data/guides/*.json', { eager: true, import: 'default' }) as Record<string, any>;

/** Guides in src/data/guides/<slug>.json, imported when their "version" is higher than the stored one. */
export async function importGuides(run: Run) {
  for (const [path, g] of Object.entries(guideFiles)) {
    const slug = path.split('/').pop()!.replace(/\.json$/, '');
    const version = Number(g.version) || 1;
    await run(`INSERT INTO guides (slug, title, h1, description) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`, [slug, g.title, g.h1, g.description]);
    const [claimed] = await run(`UPDATE guides SET version=$2 WHERE slug=$1 AND version < $2 RETURNING id`, [slug, version]);
    if (!claimed) continue;
    await saveGuide(run, claimed.id, g);
    await run(`INSERT INTO audit_log (actor, action, target, details) VALUES ('claude','import_guide',$1,$2)`, [`guide:${claimed.id}`, g.h1]);
  }
}

/** Replace a guide's fields and items. Shared by the importer and the connector. */
export async function saveGuide(run: Run, id: number, g: any) {
  await run(`UPDATE guides SET title=$2, h1=$3, description=$4, intro=$5, faq=$6, related_trope=$7, keywords=$8, status='published', updated_at=now() WHERE id=$1`,
    [id, g.title, g.h1, g.description, g.intro ?? '', JSON.stringify(g.faq ?? []), g.related_trope ?? null, g.keywords ?? []]);
  await run(`DELETE FROM guide_items WHERE guide_id=$1`, [id]);
  let pos = 0;
  for (const sec of g.sections) for (const r of sec.recs) {
    const [lb] = r.linked_slug ? await run(`SELECT id FROM books WHERE slug=$1 AND deleted_at IS NULL`, [r.linked_slug]) : [];
    await run(`INSERT INTO guide_items (guide_id, section, section_note, position, title, author, reason, linked_book_id, asin, isbn, cover_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, sec.heading, sec.note ?? '', pos++, r.title, r.author, r.reason, lb?.id ?? null, r.asin ?? null, r.isbn ?? null, r.cover_url ?? null]);
  }
  return pos;
}
