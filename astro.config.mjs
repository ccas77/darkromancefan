import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://darkromancefan.com',
  output: 'server',
  adapter: vercel({ webAnalytics: { enabled: true } }),
  security: { checkOrigin: false },
});
