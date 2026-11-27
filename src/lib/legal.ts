/**
 * Legal pages (/privacy, /affiliate-disclosure, /18-plus).
 * While APPROVED is false they are drafts: marked "Draft", kept out of search and the sitemap,
 * and not linked from the footer. The owner approves the wording, then this flips to true.
 */
export const LEGAL = {
  APPROVED: true,
  updated: '27 November 2026',
  // Owner to supply: the email readers and authors should use for privacy requests.
  contactEmail: 'hello@darkromancefan.com',
};

export const LEGAL_PAGES = [
  { path: '/privacy', label: 'Privacy policy' },
  { path: '/affiliate-disclosure', label: 'Affiliate disclosure' },
  { path: '/18-plus', label: '18+ notice' },
];
