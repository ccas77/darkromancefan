// Starter content. Titles, authors, series and first-publication years checked against Open Library.
// Covers come from Open Library. Blurbs are original. ISBNs/ASINs still to add (Claude can do this via the connector).
type Runner = (text: string, params?: any[]) => Promise<any[]>;

const NOTE = '';

const COVERS: Record<string, [number, number]> = {"i-will-break-you": [14836395, 2024], "haunting-adeline": [12992962, 2021], "twist-me": [8851882, 2014], "captive-in-the-dark": [10521960, 2011], "bound-by-honor": [10558598, 2014], "the-maddest-obsession": [11699161, 2019], "den-of-vipers": [15115000, 2020], "god-of-malice": [13291765, 2022], "corrupt": [10226443, 2015], "the-ritual": [15104748, 2021]};

const books = [
  { slug: 'i-will-break-you', title: 'I Will Break You', author: 'Gigi Styx', series: null, featured: true,
    blurb: 'A death-row killer escapes and comes for the woman who ran his online fan club. Xero Greaves calls her his little ghost, and he has no intention of letting her go.',
    tropes: ['obsession', 'morally black hero', 'serial killer', 'thriller'] },
  { slug: 'haunting-adeline', title: 'Haunting Adeline', author: 'H.D. Carlton', series: 'Cat and Mouse Duet #1', featured: true,
    blurb: 'A woman moves into her family\'s old manor and becomes the fixation of a masked man who watches her every move.',
    tropes: ['stalker', 'obsession', 'masked hero'] },
  { slug: 'twist-me', title: 'Twist Me', author: 'Anna Zaires', series: 'Twist Me #1', featured: false,
    blurb: 'Taken to a private island by a dangerous man, a young woman finds herself bound to her captor in ways she never expected.',
    tropes: ['captive', 'kidnapping', 'obsession'] },
  { slug: 'captive-in-the-dark', title: 'Captive in the Dark', author: 'C.J. Roberts', series: 'The Dark Duet #1', featured: false,
    blurb: 'An early, notoriously dark captive romance that many readers still name as the book that started it for them.',
    tropes: ['captive', 'revenge', 'morally black hero'] },
  { slug: 'bound-by-honor', title: 'Bound by Honor', author: 'Cora Reilly', series: 'Born in Blood Mafia Chronicles #1', featured: false,
    blurb: 'Promised to a feared mafia heir to keep the peace between two families, she has to marry a man known for his brutality.',
    tropes: ['mafia', 'arranged marriage'] },
  { slug: 'the-maddest-obsession', title: 'The Maddest Obsession', author: 'Danielle Lori', series: 'Made #2', featured: false,
    blurb: 'A mafia princess and the FBI agent who has every reason to stay away from her, in a slow-burning, possessive enemies-to-lovers story.',
    tropes: ['mafia', 'enemies to lovers', 'possessive hero'] },
  { slug: 'den-of-vipers', title: 'Den of Vipers', author: 'K.A. Knight', series: null, featured: false,
    blurb: 'Handed over to settle a debt, a woman ends up in the hands of four men who rule a criminal empire.',
    tropes: ['why choose', 'criminal underworld', 'debt'] },
  { slug: 'god-of-malice', title: 'God of Malice', author: 'Rina Kent', series: 'Legacy of Gods #1', featured: true,
    blurb: 'At an elite university, a girl catches the attention of a cold, calculating heir who treats her as a game he intends to win.',
    tropes: ['dark academia', 'obsession', 'morally grey hero'] },
  { slug: 'corrupt', title: 'Corrupt', author: 'Penelope Douglas', series: 'Devil\'s Night #1', featured: false,
    blurb: 'Years of tension with her boyfriend\'s older brother and his friends come to a head in a game of revenge.',
    tropes: ['revenge', 'secret society', 'bully'] },
  { slug: 'the-ritual', title: 'The Ritual', author: 'Shantel Tessier', series: 'L.O.R.D.S. #1', featured: false,
    blurb: 'At an elite university run by a powerful secret society, one of its members decides she belongs to him.',
    tropes: ['secret society', 'dark academia', 'possessive hero'] },
];

const lists = [
  { slug: 'obsession-and-captive-dark-romance', title: 'Obsession & Captive Dark Romance: Where to Start',
    intro: 'Stalkers, captors and men who will not take no for an answer. These are the books readers keep pointing newcomers towards.',
    books: ['i-will-break-you', 'haunting-adeline', 'twist-me', 'captive-in-the-dark'] },
  { slug: 'mafia-dark-romance', title: 'Mafia Dark Romance for Beginners',
    intro: 'Arranged marriages, blood debts and family loyalty. Start here if you like your heroes dangerous and your stakes high.',
    books: ['bound-by-honor', 'the-maddest-obsession', 'den-of-vipers'] },
  { slug: 'dark-academia-secret-societies', title: 'Dark Academia & Secret Society Romance',
    intro: 'Elite schools, hidden rituals and heirs who play cruel games. Dark romance with a campus setting.',
    books: ['god-of-malice', 'corrupt', 'the-ritual'] },
];

export async function seed(run: Runner) {
  const ids: Record<string, number> = {};
  for (const b of books) {
    const [row] = await run(
      `INSERT INTO books (slug,title,author,series,blurb,tropes,content_note,status,featured,cover_url,year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8,$9,$10) RETURNING id`,
      [b.slug, b.title, b.author, b.series, b.blurb, b.tropes, NOTE, b.featured,
       `https://covers.openlibrary.org/b/id/${COVERS[b.slug][0]}-L.jpg`, COVERS[b.slug][1]]);
    ids[b.slug] = row.id;
  }
  for (const l of lists) {
    const [row] = await run(`INSERT INTO lists (slug,title,intro,status) VALUES ($1,$2,$3,'published') RETURNING id`,
      [l.slug, l.title, l.intro]);
    let pos = 0;
    for (const s of l.books) await run('INSERT INTO list_items (list_id,book_id,position) VALUES ($1,$2,$3)', [row.id, ids[s], pos++]);
  }
  await run(`INSERT INTO audit_log (actor,action,details) VALUES ('system','seed','Starter content added')`);
}
