import { slugify } from './util';
export const tropeHref = (trope: string) => `/tropes/${slugify(trope)}`;
export const tropeTitle = (trope: string) => trope.replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
