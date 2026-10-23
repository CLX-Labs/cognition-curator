import { randomUUID } from 'node:crypto';
import {
  blockedUsersSchema,
  contentReportSchema,
  contentReportReceiptSchema,
} from '@recollect/contracts';
import { DomainError, transaction, type Database, type Transaction } from '@recollect/db';

function unavailable(): never {
  throw new DomainError('not_found', 'This person or shared deck is no longer available.', 404);
}

/** Serialize connection, sharing and blocking for the same two accounts. */
export async function lockCommunityPair(tx: Transaction, a: string, b: string) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return unavailable();
  const ids = [a, b].sort();
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['community-pair:' + ids.join(':')]);
  const active = await tx.query(
    'SELECT id FROM recollect.users WHERE id=ANY($1::uuid[]) AND is_active=true ORDER BY id FOR SHARE',
    [ids],
  );
  if (active.rowCount !== 2) return unavailable();
}

export async function requireUnblocked(tx: Transaction, a: string, b: string) {
  const result = await tx.query(
    `SELECT 1 FROM recollect.user_blocks WHERE (blocker_id=$1 AND blocked_id=$2)
     OR (blocker_id=$2 AND blocked_id=$1)`,
    [a, b],
  );
  // Do not reveal which participant blocked the connection.
  if (result.rowCount) return unavailable();
}

// Conservative automatic text rules for material sent to another person. They
// intentionally do not match educational subjects such as anatomy or history.
// Reports and blocking cover material these rules miss, including profile images.
export function assertShareableText(text: string) {
  const value = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ');
  const disallowed = [
    /\b(?:i(?:'|’)?ll|i will|we will|we(?:'|’)?ll) (?:kill|rape|murder) you\b/i,
    /\b(?:go|you should) (?:kill|hang) yourself\b/i,
    /\b(?:child|underage|minor) (?:porn|pornography|sexual abuse material)\b/i,
    /\b(?:how to|instructions to|guide to) (?:build|make) (?:an? )?(?:pipe bomb|suicide bomb)\b/i,
  ];
  if (disallowed.some((pattern) => pattern.test(value)))
    throw new DomainError(
      'content_not_allowed',
      'This content cannot be shared. Remove abusive, exploitative, or threatening material.',
    );
}

export class CommunitySafetyService {
  constructor(private db: Database) {}

  async blocked(owner: string) {
    const result = await this.db.query<{ id: string; name: string }>(
      `SELECT u.id,u.name FROM recollect.user_blocks b JOIN recollect.users u ON u.id=b.blocked_id
       WHERE b.blocker_id=$1 AND u.is_active=true ORDER BY b.created_at DESC,u.id`,
      [owner],
    );
    return blockedUsersSchema.parse({ users: result.rows });
  }

  async block(owner: string, target: string) {
    await transaction(this.db, async (tx) => {
      await lockCommunityPair(tx, owner, target);
      const known = await tx.query(
        `SELECT 1 FROM recollect.friendships WHERE user_a=LEAST($1::uuid,$2::uuid)
         AND user_b=GREATEST($1::uuid,$2::uuid) FOR UPDATE`,
        [owner, target],
      );
      if (!known.rowCount) return unavailable();
      await tx.query(
        'INSERT INTO recollect.user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [owner, target],
      );
      await tx.query(
        'UPDATE recollect.friendships SET active=false WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
        [owner, target],
      );
      await tx.query(
        `UPDATE recollect.deck_shares SET revoked_at=COALESCE(revoked_at,now()),
         sender_shares_progress=false,recipient_shares_progress=false
         WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)`,
        [owner, target],
      );
    });
  }

  async unblock(owner: string, target: string) {
    owner = owner.toLowerCase();
    target = target.toLowerCase();
    await transaction(this.db, async (tx) => {
      if (owner === target) return unavailable();
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'community-pair:' + [owner, target].sort().join(':'),
      ]);
      await tx.query('DELETE FROM recollect.user_blocks WHERE blocker_id=$1 AND blocked_id=$2', [
        owner,
        target,
      ]);
    });
  }

  async report(owner: string, input: unknown) {
    const request = contentReportSchema.parse(input);
    return transaction(this.db, async (tx) => {
      await lockCommunityPair(tx, owner, request.targetUserId);
      const known = await tx.query(
        'SELECT 1 FROM recollect.friendships WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
        [owner, request.targetUserId],
      );
      if (!known.rowCount) return unavailable();
      let evidence: unknown = {};
      if (request.shareId) {
        const share = (
          await tx.query<{ snapshot: unknown }>(
            `SELECT snapshot FROM recollect.deck_shares WHERE id=$1
           AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2))`,
            [request.shareId, owner, request.targetUserId],
          )
        ).rows[0];
        if (!share) return unavailable();
        evidence = share.snapshot;
      }
      const limit = await tx.query<{ count: number }>(
        `INSERT INTO recollect.rate_buckets(scope,bucket,count) VALUES($1,$2,1)
         ON CONFLICT(scope,bucket) DO UPDATE SET count=recollect.rate_buckets.count+1 RETURNING count`,
        ['community:report:' + owner, Math.floor(Date.now() / 60_000)],
      );
      if (limit.rows[0]!.count > 10)
        throw new DomainError('rate_limited', 'Too many reports; retry in a minute.', 429);
      const id = randomUUID();
      const row = (
        await tx.query<{ created_at: Date }>(
          `INSERT INTO recollect.content_reports(id,reporter_id,target_user_id,share_id,reason,details,evidence)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING created_at`,
          [
            id,
            owner,
            request.targetUserId,
            request.shareId ?? null,
            request.reason,
            request.details ?? '',
            evidence,
          ],
        )
      ).rows[0]!;
      return contentReportReceiptSchema.parse({ id, createdAt: row.created_at.toISOString() });
    });
  }
}
