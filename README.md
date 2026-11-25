# darkromancefan.com

Astro site on Vercel with a Postgres database (Neon). Reader comments, ratings, trope votes, reactions and book suggestions are stored in the database and rendered into the page, so search engines see them.

## Run locally
    npm install
    ADMIN_KEY=some-long-random-string-at-least-24 npm run dev
Without DATABASE_URL it uses a built-in local database in `.data/` and fills it with starter content.

## Go live (Vercel)
1. Create a Vercel project from this folder.
2. Add a Neon Postgres database from the Vercel Marketplace (it sets DATABASE_URL). Tables and starter content are created on first visit.
3. Add the settings listed in `.env.example`. ADMIN_KEY and HASH_SALT are required.
4. Point darkromancefan.com at the project.

## Stripe
Create three Payment Links (New Release Spotlight, Featured Deal, Launch Bundle) with custom text fields
keyed `booktitle`, `booklink` and `preferreddate`. Put the link URLs in PROMO_LINK_*.
Add a webhook to `https://darkromancefan.com/api/stripe-webhook` for `checkout.session.completed`
and put its signing secret in STRIPE_WEBHOOK_SECRET.

## Claude connector
In Claude: Settings → Connectors → Add custom connector, URL:
    https://darkromancefan.com/mcp/<ADMIN_KEY>
Treat this URL like a password. To revoke access, change ADMIN_KEY in Vercel and redeploy.

Rules (Balanced) are enforced in `src/lib/actions.ts` and `src/lib/mcp.ts`:
- Claude can approve clean comments, mark spam, ban commenters with spam on record, and make small edits.
- Flagged or reported comments, new books and new lists go to the owner's queue at /admin.
- Newsletter issues are drafts only. Claude cannot send, refund or charge.
- Everything is recorded in the activity log at /admin.

## Admin page
https://darkromancefan.com/admin (sign in with ADMIN_KEY).

## Starter content
`src/lib/seed.ts` has 10 books in 3 lists with short, original blurbs. Check them, and add ISBNs (for Bookshop
affiliate links) and ASINs (for Amazon), or ask Claude to through the connector.
