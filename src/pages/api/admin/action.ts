import type { APIRoute } from 'astro';
import { isOwner } from '../../../lib/auth';
import { q, audit } from '../../../lib/db';
import { approveComment, rejectComment, restoreComment, decideApproval, setBan, PolicyError } from '../../../lib/actions';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isOwner(cookies)) return new Response('Unauthorised', { status: 401 });
  const f = await request.formData();
  const action = String(f.get('action')); const id = Number(f.get('id'));
  try {
    switch (action) {
      case 'approval_yes': await decideApproval(id, true); break;
      case 'approval_no': await decideApproval(id, false); break;
      case 'comment_approve': await approveComment(id, 'owner'); break;
      case 'comment_reject': await rejectComment(id, 'owner'); break;
      case 'comment_spam': await rejectComment(id, 'owner', 'spam'); break;
      case 'comment_restore': await restoreComment(id, 'owner'); break;
      case 'ban': await setBan(id, true, 'owner'); break;
      case 'suggestion_close': await q(`UPDATE suggestions SET status='rejected' WHERE id=$1`, [id]); await audit('owner', 'close_suggestion', `suggestion:${id}`); break;
      case 'issue_sent': await q(`UPDATE newsletter_issues SET status='sent', updated_at=now() WHERE id=$1`, [id]); await q(`UPDATE promo_bookings SET status='run' WHERE issue_id=$1`, [id]); await audit('owner', 'mark_issue_sent', `issue:${id}`); break;
      case 'revoke_connectors': await q(`UPDATE oauth_tokens SET revoked=true WHERE NOT revoked`); await audit('owner', 'revoke_connectors', ''); break;
      case 'logout': cookies.delete('drf_admin', { path: '/' }); break;
    }
  } catch (e) { if (!(e instanceof PolicyError)) throw e; }
  return new Response(null, { status: 303, headers: { Location: '/admin' + (f.get('anchor') ? '#' + f.get('anchor') : '') } });
};
