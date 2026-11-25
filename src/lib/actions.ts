// Shared back-end actions used by the admin page and the Claude connector.
// The "Balanced" rules live here so they apply however an action is triggered.
import { q, one, audit } from './db';

export class PolicyError extends Error {}

export async function approveComment(id: number, actor: string) {
  const c = await one(`SELECT * FROM comments WHERE id=$1`, [id]);
  if (!c) throw new PolicyError(`Comment ${id} not found`);
  if (actor !== 'owner') {
    const reports = await one(`SELECT count(*)::int AS n FROM reports WHERE comment_id=$1 AND NOT resolved`, [id]);
    if (c.flags.length || reports!.n > 0 || c.status === 'flagged') {
      throw new PolicyError(`Comment ${id} is borderline (${[...c.flags, reports!.n ? 'reported' : ''].filter(Boolean).join(', ')}). ` +
        `Under the Balanced rules only the owner can approve it. Use escalate_comment to send it to the owner's approval queue.`);
    }
  }
  await q(`UPDATE comments SET status='approved', decided_at=now(), decided_by=$2 WHERE id=$1`, [id, actor]);
  await q(`UPDATE commenters SET trusted=true WHERE id=$1`, [c.commenter_id]);
  await q(`UPDATE reports SET resolved=true WHERE comment_id=$1`, [id]);
  await q(`UPDATE approvals SET status='approved', decided_at=now() WHERE kind='comment' AND target_id=$1 AND status='pending'`, [id]);
  await audit(actor, 'approve_comment', `comment:${id}`);
}

export async function rejectComment(id: number, actor: string, as: 'rejected' | 'spam' = 'rejected', reason = '') {
  const c = await one(`SELECT id FROM comments WHERE id=$1`, [id]);
  if (!c) throw new PolicyError(`Comment ${id} not found`);
  await q(`UPDATE comments SET status=$2, decided_at=now(), decided_by=$3 WHERE id=$1`, [id, as, actor]);
  await q(`UPDATE reports SET resolved=true WHERE comment_id=$1`, [id]);
  await q(`UPDATE approvals SET status='declined', decided_at=now() WHERE kind='comment' AND target_id=$1 AND status='pending'`, [id]);
  await audit(actor, as === 'spam' ? 'mark_spam' : 'reject_comment', `comment:${id}`, reason);
}

export async function restoreComment(id: number, actor: string) {
  await q(`UPDATE comments SET status='pending', decided_at=NULL, decided_by=NULL WHERE id=$1`, [id]);
  await audit(actor, 'restore_comment', `comment:${id}`);
}

export async function requestApproval(kind: 'comment' | 'list' | 'book', targetId: number, summary: string, actor: string) {
  const existing = await one(`SELECT id FROM approvals WHERE kind=$1 AND target_id=$2 AND status='pending'`, [kind, targetId]);
  if (existing) return existing.id as number;
  const row = await one(`INSERT INTO approvals (kind,target_id,summary,requested_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [kind, targetId, summary, actor]);
  if (kind === 'comment') await q(`UPDATE comments SET status='flagged' WHERE id=$1 AND status='pending'`, [targetId]);
  await audit(actor, 'request_approval', `${kind}:${targetId}`, summary);
  return row!.id as number;
}

/** Owner only: approve or decline something in the approval queue. */
export async function decideApproval(id: number, approve: boolean) {
  const a = await one(`SELECT * FROM approvals WHERE id=$1 AND status='pending'`, [id]);
  if (!a) throw new PolicyError('Approval not found or already decided');
  if (a.kind === 'comment') {
    if (approve) await approveComment(a.target_id, 'owner'); else await rejectComment(a.target_id, 'owner');
  } else if (a.kind === 'list' || a.kind === 'book') {
    const table = a.kind === 'list' ? 'lists' : 'books';
    if (approve) await q(`UPDATE ${table} SET status='published', updated_at=now() WHERE id=$1`, [a.target_id]);
    await audit('owner', approve ? `publish_${a.kind}` : `decline_${a.kind}`, `${a.kind}:${a.target_id}`);
  }
  await q(`UPDATE approvals SET status=$2, decided_at=now() WHERE id=$1`, [id, approve ? 'approved' : 'declined']);
}

export async function setBan(commenterId: number, banned: boolean, actor: string) {
  await q(`UPDATE commenters SET banned=$2 WHERE id=$1`, [commenterId, banned]);
  if (banned) await q(`UPDATE comments SET status='rejected', decided_at=now(), decided_by=$2 WHERE commenter_id=$1 AND status IN ('pending','flagged')`, [commenterId, actor]);
  await audit(actor, banned ? 'ban_commenter' : 'unban_commenter', `commenter:${commenterId}`);
}
