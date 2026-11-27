CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  series TEXT,
  blurb TEXT NOT NULL DEFAULT '',
  tropes TEXT[] NOT NULL DEFAULT '{}',
  content_note TEXT NOT NULL DEFAULT '',
  isbn TEXT,
  asin TEXT,
  cover_url TEXT,
  year INT,
  status TEXT NOT NULL DEFAULT 'draft',
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS lists (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS list_items (
  list_id INT NOT NULL REFERENCES lists(id),
  book_id INT NOT NULL REFERENCES books(id),
  position INT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (list_id, book_id)
);
CREATE TABLE IF NOT EXISTS commenters (
  id SERIAL PRIMARY KEY,
  email_hash TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  trusted BOOLEAN NOT NULL DEFAULT false,
  banned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  book_id INT REFERENCES books(id),
  list_id INT REFERENCES lists(id),
  commenter_id INT NOT NULL REFERENCES commenters(id),
  body TEXT NOT NULL,
  spoiler BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  flags TEXT[] NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT
);
CREATE TABLE IF NOT EXISTS ratings (
  book_id INT NOT NULL REFERENCES books(id),
  voter TEXT NOT NULL,
  overall INT NOT NULL,
  spice INT NOT NULL,
  darkness INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, voter)
);
CREATE TABLE IF NOT EXISTS trope_votes (
  book_id INT NOT NULL REFERENCES books(id),
  trope TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, trope, voter)
);
CREATE TABLE IF NOT EXISTS reactions (
  book_id INT NOT NULL REFERENCES books(id),
  voter TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, voter)
);
CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  list_id INT REFERENCES lists(id),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  comment_id INT NOT NULL REFERENCES comments(id),
  reason TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id INT NOT NULL,
  summary TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS promo_bookings (
  id SERIAL PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  package TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_email TEXT NOT NULL DEFAULT '',
  book_title TEXT NOT NULL DEFAULT '',
  book_url TEXT NOT NULL DEFAULT '',
  preferred_date TEXT NOT NULL DEFAULT '',
  amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'new',
  issue_id INT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_issues (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  send_date TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  beehiiv_post_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signups (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT '',
  synced BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clicks (
  id SERIAL PRIMARY KEY,
  book_id INT NOT NULL,
  store TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE books ADD COLUMN IF NOT EXISTS year INT;
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL DEFAULT '',
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cover_cache (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Books like X": curated recommendations shown on each book page. Recs don't need their own
-- book page. When one does exist (linked_book_id) the card links to it.
CREATE TABLE IF NOT EXISTS book_recs (
  id SERIAL PRIMARY KEY,
  book_id INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  section_note TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  reason TEXT NOT NULL,
  linked_book_id INT REFERENCES books(id) ON DELETE SET NULL,
  asin TEXT,
  isbn TEXT,
  cover_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS book_recs_book ON book_recs (book_id, position);
ALTER TABLE books ADD COLUMN IF NOT EXISTS recs_intro TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS rec_id INT
;
ALTER TABLE books ADD COLUMN IF NOT EXISTS recs_version INT NOT NULL DEFAULT 0
