import { env } from './env';

// Starting prices. Change them here and in Stripe together.
export const PACKAGES = [
  { key: 'new_release', name: 'New Release Spotlight', price: '$25', env: 'PROMO_LINK_NEW_RELEASE',
    points: ['Your new release in one weekly issue', 'Cover, hook line and buy links', 'Listed in the "new this week" section'] },
  { key: 'featured', name: 'Featured Deal', price: '$40', env: 'PROMO_LINK_FEATURED',
    points: ['Top-of-issue placement for a free or discounted book', 'Cover, longer write-up and trope tags', 'Added to a matching trope list on the site for 30 days'] },
  { key: 'launch', name: 'Launch Bundle', price: '$90', env: 'PROMO_LINK_LAUNCH',
    points: ['Featured placement in two issues, around launch day', 'A book page on darkromancefan.com with reader ratings and comments', 'Click report after the promo'] },
];

export const linkFor = (key: string) => env(PACKAGES.find((p) => p.key === key)!.env);

export function packageForLink(paymentLinkId?: string | null) {
  if (!paymentLinkId) return '';
  // Payment Link URLs don't contain their plink_ id, so set PROMO_PLINK_<KEY> if you want exact matching.
  for (const p of PACKAGES) if (env(`PROMO_PLINK_${p.key.toUpperCase()}`) === paymentLinkId) return p.key;
  return '';
}
