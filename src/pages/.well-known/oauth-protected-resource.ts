import type { APIRoute } from 'astro';
import { origin, json } from '../../lib/oauth';
export const GET: APIRoute = ({ request }) => {
  const o = origin(request);
  return json({ resource: `${o}/mcp`, authorization_servers: [o], scopes_supported: ['admin'], bearer_methods_supported: ['header'], resource_name: 'Dark Romance Fan back office' });
};
