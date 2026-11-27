import { slugify } from './util';
export const tropeHref = (trope: string) => `/tropes/${slugify(trope)}`;
export const tropeTitle = (trope: string) => trope.replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/** Old trope tags merged into the wording readers search for. Old URLs redirect. */
export const TROPE_ALIASES: Record<string, string> = {
  'masked-hero': 'masked-man', 'morally-grey': 'morally-grey-hero', 'obsession': 'obsessive-hero', 'serial-killer-hero': 'serial-killer',
};
/** Trope pages with fewer books than this are kept out of search results until they grow. */
export const MIN_TROPE_BOOKS = 3;
