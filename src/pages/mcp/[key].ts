import type { APIRoute } from 'astro';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../../lib/mcp';
import { keyMatches } from '../../lib/auth';

// Claude connector endpoint: https://darkromancefan.com/mcp/<ADMIN_KEY>
// The secret key in the URL is what protects it, so keep the full URL private.
const handle: APIRoute = async ({ request, params }) => {
  if (!keyMatches(params.key || '')) return new Response('Not found', { status: 404 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer();
  await server.connect(transport);
  return transport.handleRequest(request);
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
