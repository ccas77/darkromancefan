import type { APIRoute } from 'astro';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../../lib/mcp';
import { validAccess, origin } from '../../lib/oauth';

// Claude connector: https://www.darkromancefan.com/mcp (OAuth sign-in with the admin key).
const handle: APIRoute = async ({ request }) => {
  if (!(await validAccess(request))) {
    const accept = request.headers.get('accept') || '';
    if (request.method === 'GET' && accept.includes('text/html')) {
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>Dark Romance Fan connector</title><body style="font:16px/1.6 system-ui;max-width:560px;margin:60px auto;padding:0 20px;color:#0f1111"><h1 style="font-size:1.4rem">Dark Romance Fan connector</h1><p>This address is for Claude, not for browsing. To connect it, add it in Claude as a custom connector:</p><p><code style="background:#f3f4f5;padding:4px 8px;border-radius:4px">${origin(request)}/mcp</code></p><p>Claude will then ask you to sign in with your admin key.</p><p><a href="/" style="color:#c8102e">Back to the site</a></p></body>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"`,
    } });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer();
  await server.connect(transport);
  return transport.handleRequest(request);
};
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
