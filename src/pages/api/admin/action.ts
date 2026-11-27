import type { APIRoute } from 'astro';
import { isOwner } from '../../../lib/auth';
import { q, audit } from '../../../lib/db';
import { approveComment, rejectComment, restoreComment, decideApproval, approveAllContent, setBan, PolicyError } from '../../../lib/actions';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isOwner(cookies)) return new Response('Unauthorised', { status: 401 });
  const f = await request.formData();
  const action = String(f.get('action')); const id = Number(f.get('id'));
  let msg = '';
  try {
    switch (action) {
      case 'approval_yes': await decideApproval(id, true); msg = 'Approved and live.'; break;
      case 'approval_no': await decideApproval(id, false); msg = 'Declined.'; break;
      case 'approval_all': { const n = await approveAllContent(f.getAll('ids').map(Number).filter(Boolean)); msg = `Approved ${n} and published.`; break; }
      case 'unpublish':
      case 'republish': {
        const table = f.get('kind') === 'list' ? 'lists' : 'books'; const status = action === 'unpublish' ? 'draft' : 'published';
        await q(`UPDATE ${table} SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
        await audit('owner', `${action}_${table.slice(0, -1)}`, `${table.slice(0, -1)}:${id}`);
        msg = action === 'unpublish' ? 'Taken down. It is no longer on the site.' : 'Back live.'; break;
      }
      case 'comment_approve': await approveComment(id, 'owner'); break;
      case 'comment_reject': await rejectComment(id, 'owner'); msg = 'Comment removed.'; break;
      case 'comment_spam': await rejectComment(id, 'owner', 'spam'); break;
      case 'comment_restore': await restoreComment(id, 'owner'); break;
      case 'ban': await setBan(id, true, 'owner'); break;
      case 'suggestion_close': await q(`UPDATE suggestions SET status='rejected' WHERE id=$1`, [id]); await audit('owner', 'close_suggestion', `suggestion:${id}`); break;
      case 'issue_sent': await q(`UPDATE newsletter_issues SET status='sent', updated_at=now() WHERE id=$1`, [id]); await q(`UPDATE promo_bookings SET status='run' WHERE issue_id=$1`, [id]); await audit('owner', 'mark_issue_sent', `issue:${id}`); break;
      case 'revoke_connectors': await q(`UPDATE oauth_tokens SET revoked=true WHERE NOT revoked`); await audit('owner', 'revoke_connectors', ''); break;
      case 'logout': cookies.delete('drf_admin', { path: '/' }); break;
    }
  } catch (e: any) {
    if (!(e instanceof PolicyError)) { console.error('admin action failed', action, e); msg = `Something went wrong (${action}). Claude can see this in the logs.`; }
    else msg = e.message;
  }
  const qs = msg ? '?msg=' + encodeURIComponent(msg) : '';
  return new Response(null, { status: 303, headers: { Location: '/admin' + qs + (f.get('anchor') ? '#' + f.get('anchor') : '') } });
};
