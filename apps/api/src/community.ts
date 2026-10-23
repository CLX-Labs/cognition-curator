import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  acceptInviteSchema,
  acceptShareSchema,
  buildRecallInsights,
  communityOverviewSchema,
  createShareSchema,
  deckShareSchema,
  friendInviteSchema,
  progressPermissionSchema,
  recallInsightsSchema,
  shareDetailSchema,
  type Card,
  type CommunityOverview,
  type CommunityPerson,
  type Deck,
  type DeckShare,
  type FriendInvite,
  type InsightCard,
  type RecallInsights,
  type ReviewEvent,
  type SharedCard,
  type SharedDeckSummary,
} from '@recollect/contracts';
import {
  appendChanges,
  DomainError,
  hash,
  lockOwner,
  secretHash,
  transaction,
  type Change,
  type Database,
  type Transaction,
} from '@recollect/db';
import { initialSchedule } from '@recollect/scheduler';
import { assertShareableText, lockCommunityPair, requireUnblocked } from './community-safety.js';

type ShareSnapshot = { deck: SharedDeckSummary; cards: SharedCard[] };
type ShareRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  source_deck_id: string;
  payload_hash: string;
  snapshot: ShareSnapshot;
  source_revision: string;
  recipient_deck_id: string | null;
  recipient_revision: string | null;
  sender_shares_progress: boolean;
  recipient_shares_progress: boolean;
  created_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};
type InsightQuery = {
  days: 7 | 30 | 90 | null;
  timezone: string;
  deckId?: string;
  cardId?: string;
};
const querySchema = z.strictObject({
  days: z.enum(['7', '30', '90', 'all']).default('30'),
  timezone: z.string().max(100).default('UTC'),
  deckId: z.uuid().toLowerCase().optional(),
  cardId: z.uuid().toLowerCase().optional(),
});
function parseQuery(input: unknown, shared = false): InsightQuery {
  const query = (shared ? querySchema.omit({ deckId: true }) : querySchema).parse(input);
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: query.timezone });
  } catch {
    throw new DomainError('invalid_timezone', 'Use a valid IANA timezone.');
  }
  return { ...query, days: query.days === 'all' ? null : (Number(query.days) as 7 | 30 | 90) };
}
function pair(a: string, b: string): [string, string] {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a < b ? [a, b] : [b, a];
}
function notFound(): never {
  throw new DomainError('not_found', 'This friend or shared deck is no longer available.', 404);
}
function cardContent(card: SharedCard) {
  return {
    front: card.front,
    back: card.back,
    hint: card.hint,
    explanation: card.explanation,
    tags: card.tags,
    aiGenerated: card.aiGenerated,
  };
}
function sharedCard(card: Card): SharedCard {
  return { id: card.id, ...cardContent(card) };
}
async function people(tx: Transaction, ids: string[]): Promise<Map<string, CommunityPerson>> {
  const result = await tx.query<CommunityPerson>(
    `SELECT id,name,profile_photo_data_url AS "photoDataUrl" FROM recollect.users
     WHERE id=ANY($1::uuid[]) AND is_active=true`,
    [ids],
  );
  return new Map(result.rows.map((person) => [person.id, person]));
}
function formatShare(row: ShareRow, profiles: Map<string, CommunityPerson>): DeckShare {
  const sender = profiles.get(row.sender_id),
    recipient = profiles.get(row.recipient_id);
  if (!sender || !recipient) return notFound();
  return deckShareSchema.parse({
    id: row.id,
    sender,
    recipient,
    sourceDeckId: row.source_deck_id,
    deck: row.snapshot.deck,
    cardCount: row.snapshot.cards.length,
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    recipientDeckId: row.recipient_deck_id,
    senderSharesProgress: row.sender_shares_progress,
    recipientSharesProgress: row.recipient_shares_progress,
  });
}

export class CommunityService {
  constructor(private db: Database) {}

  private async throttle(owner: string, action: string, limit: number) {
    const result = await this.db.query<{ count: number }>(
      `INSERT INTO recollect.rate_buckets(scope,bucket,count) VALUES($1,$2,1)
       ON CONFLICT(scope,bucket) DO UPDATE SET count=recollect.rate_buckets.count+1 RETURNING count`,
      ['community:' + action + ':' + owner, Math.floor(Date.now() / 60_000)],
    );
    if (result.rows[0]!.count > limit)
      throw new DomainError('rate_limited', 'Too many requests; retry in a minute.', 429);
  }

  private async lockFriend(tx: Transaction, owner: string, friend: string) {
    if (owner === friend) return notFound();
    await lockCommunityPair(tx, owner, friend);
    await requireUnblocked(tx, owner, friend);
    const result = await tx.query(
      `SELECT f.user_a FROM recollect.friendships f
       JOIN recollect.users a ON a.id=f.user_a AND a.is_active=true
       JOIN recollect.users b ON b.id=f.user_b AND b.is_active=true
       WHERE f.user_a=$1 AND f.user_b=$2 AND f.active=true FOR UPDATE OF f`,
      pair(owner, friend),
    );
    if (!result.rowCount) return notFound();
  }

  private async lockedShare(tx: Transaction, owner: string, id: string): Promise<ShareRow> {
    const initial = (
      await tx.query<ShareRow>('SELECT * FROM recollect.deck_shares WHERE id=$1', [id])
    ).rows[0];
    if (!initial || (initial.sender_id !== owner && initial.recipient_id !== owner))
      return notFound();
    await this.lockFriend(tx, initial.sender_id, initial.recipient_id);
    const row = (
      await tx.query<ShareRow>('SELECT * FROM recollect.deck_shares WHERE id=$1 FOR UPDATE', [id])
    ).rows[0]!;
    if (row.revoked_at) return notFound();
    return row;
  }

  async overview(owner: string): Promise<CommunityOverview> {
    return transaction(this.db, async (tx) => {
      const friends = await tx.query<CommunityPerson & { connectedAt: Date }>(
        `SELECT u.id,u.name,u.profile_photo_data_url AS "photoDataUrl",f.connected_at AS "connectedAt"
         FROM recollect.friendships f JOIN recollect.users u
         ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
         WHERE (f.user_a=$1 OR f.user_b=$1) AND f.active=true AND u.is_active=true
         AND NOT EXISTS (SELECT 1 FROM recollect.user_blocks b
          WHERE (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1))
         ORDER BY f.connected_at DESC,u.id`,
        [owner],
      );
      const shares = await tx.query<ShareRow>(
        `SELECT s.* FROM recollect.deck_shares s JOIN recollect.friendships f
         ON f.user_a=LEAST(s.sender_id,s.recipient_id) AND f.user_b=GREATEST(s.sender_id,s.recipient_id)
         WHERE (s.sender_id=$1 OR s.recipient_id=$1) AND s.revoked_at IS NULL AND f.active=true
         AND NOT EXISTS (SELECT 1 FROM recollect.user_blocks b
          WHERE (b.blocker_id=s.sender_id AND b.blocked_id=s.recipient_id)
          OR (b.blocker_id=s.recipient_id AND b.blocked_id=s.sender_id))
         ORDER BY s.created_at DESC,s.id`,
        [owner],
      );
      const profiles = await people(tx, [owner, ...friends.rows.map((friend) => friend.id)]);
      return communityOverviewSchema.parse({
        friends: friends.rows.map((friend) => ({
          ...friend,
          connectedAt: friend.connectedAt.toISOString(),
        })),
        shares: shares.rows
          .filter((share) => profiles.has(share.sender_id) && profiles.has(share.recipient_id))
          .map((share) => formatShare(share, profiles)),
      });
    });
  }

  async createInvite(owner: string): Promise<FriendInvite> {
    await this.throttle(owner, 'invite', 10);
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await transaction(this.db, async (tx) => {
      const user = (
        await tx.query<{ name: string }>(
          'SELECT name FROM recollect.users WHERE id=$1 AND is_active=true FOR SHARE',
          [owner],
        )
      ).rows[0];
      if (!user) return notFound();
      assertShareableText(user.name);
      await tx.query(
        'INSERT INTO recollect.friend_invites(id,owner_id,code_hash,expires_at) VALUES($1,$2,$3,$4)',
        [randomUUID(), owner, secretHash(code), expiresAt],
      );
    });
    return friendInviteSchema.parse({ code, expiresAt });
  }

  async acceptInvite(owner: string, input: unknown): Promise<CommunityOverview> {
    const { code } = acceptInviteSchema.parse(input);
    await this.throttle(owner, 'accept-invite', 20);
    await transaction(this.db, async (tx) => {
      // Read the immutable owner first, then lock users before the invitation.
      // Deletion locks the account before removing invitations in that order.
      const initial = (
        await tx.query<{ owner_id: string }>(
          'SELECT owner_id FROM recollect.friend_invites WHERE code_hash=$1',
          [secretHash(code)],
        )
      ).rows[0];
      if (!initial)
        throw new DomainError(
          'invalid_invite',
          'This invite has expired or is no longer available.',
          404,
        );
      if (initial.owner_id === owner)
        throw new DomainError('self_invite', 'Send this invite to a friend to connect.');
      await lockCommunityPair(tx, owner, initial.owner_id);
      await requireUnblocked(tx, owner, initial.owner_id);
      const invite = (
        await tx.query<{
          id: string;
          owner_id: string;
          expires_at: Date;
          consumed_by: string | null;
        }>('SELECT * FROM recollect.friend_invites WHERE code_hash=$1 FOR UPDATE', [
          secretHash(code),
        ])
      ).rows[0];
      if (!invite || invite.expires_at.getTime() <= Date.now())
        throw new DomainError(
          'invalid_invite',
          'This invite has expired or is no longer available.',
          404,
        );
      if (invite.owner_id === owner)
        throw new DomainError('self_invite', 'Send this invite to a friend to connect.');
      const profiles = await people(tx, [owner, invite.owner_id]);
      if (profiles.size !== 2) return notFound();
      for (const profile of profiles.values()) assertShareableText(profile.name);
      // A lost response can be retried by the same recipient. A consumed invite
      // never creates another connection or reconnects a removed friendship.
      if (invite.consumed_by) {
        if (invite.consumed_by !== owner)
          throw new DomainError('invite_used', 'This invite has already been accepted.', 409);
        await this.lockFriend(tx, owner, invite.owner_id);
        return;
      }
      await tx.query(
        `INSERT INTO recollect.friendships(user_a,user_b) VALUES($1,$2)
         ON CONFLICT(user_a,user_b) DO UPDATE SET active=true,
         connected_at=CASE WHEN recollect.friendships.active THEN recollect.friendships.connected_at ELSE now() END`,
        pair(owner, invite.owner_id),
      );
      await tx.query(
        'UPDATE recollect.friend_invites SET consumed_by=$2,consumed_at=now() WHERE id=$1',
        [invite.id, owner],
      );
    });
    return this.overview(owner);
  }

  async removeFriend(owner: string, friend: string): Promise<CommunityOverview> {
    await transaction(this.db, async (tx) => {
      await this.lockFriend(tx, owner, friend);
      await tx.query(
        'UPDATE recollect.friendships SET active=false WHERE user_a=$1 AND user_b=$2',
        pair(owner, friend),
      );
      await tx.query(
        `UPDATE recollect.deck_shares SET revoked_at=now(),sender_shares_progress=false,recipient_shares_progress=false
         WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) AND revoked_at IS NULL`,
        [owner, friend],
      );
    });
    return this.overview(owner);
  }

  async createShare(owner: string, input: unknown): Promise<DeckShare> {
    const request = createShareSchema.parse(input);
    await this.throttle(owner, 'share', 20);
    return transaction(this.db, async (tx) => {
      await this.lockFriend(tx, owner, request.friendId);
      const revision = await lockOwner(tx, owner);
      const payloadHash = hash(request);
      const existing = (
        await tx.query<ShareRow>(
          'SELECT * FROM recollect.deck_shares WHERE sender_id=$1 AND operation_id=$2',
          [owner, request.operationId],
        )
      ).rows[0];
      const profiles = await people(tx, [owner, request.friendId]);
      if (existing) {
        if (existing.payload_hash !== payloadHash)
          throw new DomainError(
            'operation_id_reused',
            'Use a new operation ID for a different share.',
            409,
          );
        if (existing.revoked_at) return notFound();
        return formatShare(existing, profiles);
      }
      const deck = (
        await tx.query<{ data: Deck }>(
          `SELECT data FROM recollect.decks WHERE owner_id=$1 AND id=$2 AND data->>'deletedAt' IS NULL`,
          [owner, request.deckId],
        )
      ).rows[0]?.data;
      if (!deck) return notFound();
      const cards = (
        await tx.query<{ data: Card }>(
          `SELECT data FROM recollect.cards WHERE owner_id=$1 AND deck_id=$2 AND data->>'deletedAt' IS NULL
         ORDER BY id LIMIT 1001`,
          [owner, deck.id],
        )
      ).rows.map(({ data }) => sharedCard(data));
      if (cards.length > 1000)
        throw new DomainError('deck_too_large', 'Share a deck with at most 1,000 cards.');
      if (!cards.length) throw new DomainError('empty_deck', 'Add cards before sharing this deck.');
      const snapshot: ShareSnapshot = {
        deck: {
          id: deck.id,
          name: deck.name,
          description: deck.description,
          color: deck.color,
          icon: deck.icon,
        },
        cards,
      };
      assertShareableText(
        [
          snapshot.deck.name,
          snapshot.deck.description,
          ...cards.flatMap((card) => [
            card.front,
            card.back,
            card.hint,
            card.explanation,
            ...card.tags,
          ]),
        ].join('\n'),
      );
      const row = (
        await tx.query<ShareRow>(
          `INSERT INTO recollect.deck_shares(id,sender_id,recipient_id,operation_id,payload_hash,source_deck_id,snapshot,source_revision,sender_shares_progress)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            owner,
            request.friendId,
            request.operationId,
            payloadHash,
            deck.id,
            snapshot,
            revision.toString(),
            request.shareProgress,
          ],
        )
      ).rows[0]!;
      return formatShare(row, profiles);
    });
  }

  async detail(owner: string, id: string) {
    return transaction(this.db, async (tx) => {
      const row = await this.lockedShare(tx, owner, id);
      return shareDetailSchema.parse({
        share: formatShare(row, await people(tx, [row.sender_id, row.recipient_id])),
        cards: row.snapshot.cards,
      });
    });
  }

  async acceptShare(owner: string, id: string, input: unknown): Promise<DeckShare> {
    const request = acceptShareSchema.parse(input);
    return transaction(this.db, async (tx) => {
      const row = await this.lockedShare(tx, owner, id);
      if (row.recipient_id !== owner) return notFound();
      if (!row.accepted_at) {
        await lockOwner(tx, owner);
        const now = new Date().toISOString();
        const deck: Deck = {
          ...row.snapshot.deck,
          id: randomUUID(),
          ownerId: owner,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          isSilenced: false,
          silencedUntil: null,
        };
        await tx.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
          owner,
          deck.id,
          deck,
        ]);
        const changes: Change[] = [{ entity: 'deck', data: deck }];
        for (const source of row.snapshot.cards) {
          const card: Card = {
            ...source,
            id: randomUUID(),
            deckId: deck.id,
            ownerId: owner,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            schedule: initialSchedule(now),
          };
          await tx.query(
            'INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at) VALUES($1,$2,$3,$4,$5,$6)',
            [owner, card.id, deck.id, card, card.schedule, now],
          );
          await tx.query(
            'INSERT INTO recollect.shared_card_mappings(share_id,source_card_id,recipient_card_id,content_hash) VALUES($1,$2,$3,$4)',
            [id, source.id, card.id, hash(cardContent(source))],
          );
          changes.push({ entity: 'card', data: card });
        }
        const revision = await appendChanges(tx, owner, changes);
        const updated = (
          await tx.query<ShareRow>(
            `UPDATE recollect.deck_shares SET accepted_at=now(),recipient_deck_id=$2,recipient_revision=$3,recipient_shares_progress=$4 WHERE id=$1 RETURNING *`,
            [id, deck.id, revision, request.shareProgress],
          )
        ).rows[0]!;
        return formatShare(updated, await people(tx, [row.sender_id, row.recipient_id]));
      }
      // Acceptance retries never overwrite an independently changed permission.
      return formatShare(row, await people(tx, [row.sender_id, row.recipient_id]));
    });
  }

  async setProgress(owner: string, id: string, input: unknown): Promise<DeckShare> {
    const { enabled } = progressPermissionSchema.parse(input);
    return transaction(this.db, async (tx) => {
      const row = await this.lockedShare(tx, owner, id);
      const column =
        row.sender_id === owner ? 'sender_shares_progress' : 'recipient_shares_progress';
      const updated = (
        await tx.query<ShareRow>(
          `UPDATE recollect.deck_shares SET ${column}=$2 WHERE id=$1 RETURNING *`,
          [id, enabled],
        )
      ).rows[0]!;
      return formatShare(updated, await people(tx, [row.sender_id, row.recipient_id]));
    });
  }

  async revokeShare(owner: string, id: string): Promise<CommunityOverview> {
    await transaction(this.db, async (tx) => {
      await this.lockedShare(tx, owner, id);
      await tx.query(
        'UPDATE recollect.deck_shares SET revoked_at=now(),sender_shares_progress=false,recipient_shares_progress=false WHERE id=$1',
        [id],
      );
    });
    return this.overview(owner);
  }

  private async scopedCards(tx: Transaction, row: ShareRow, target: string) {
    const sender = target === row.sender_id;
    const expectedDeckId = sender ? row.source_deck_id : row.recipient_deck_id!;
    const mappings = (
      await tx.query<{ source_card_id: string; recipient_card_id: string; content_hash: string }>(
        'SELECT * FROM recollect.shared_card_mappings WHERE share_id=$1',
        [row.id],
      )
    ).rows;
    const hashes = new Map(
      mappings.map((mapping) => [
        sender ? mapping.source_card_id : mapping.recipient_card_id,
        mapping.content_hash,
      ]),
    );
    const baseline = sender ? row.source_revision : row.recipient_revision!;
    const result = await tx.query<{ data: Card; deck_name: string }>(
      `SELECT c.data,d.data->>'name' AS deck_name FROM recollect.cards c JOIN recollect.decks d ON d.owner_id=c.owner_id AND d.id=c.deck_id
       WHERE c.owner_id=$1 AND c.id=ANY($2::uuid[]) AND c.data->>'deletedAt' IS NULL AND d.data->>'deletedAt' IS NULL`,
      [target, [...hashes.keys()]],
    );
    const edited = new Set<string>();
    const changes = await tx.query<{ data: Card }>(
      `SELECT data FROM recollect.changes WHERE owner_id=$1 AND revision>$2 AND entity='card' AND data->>'id'=ANY($3::text[])`,
      [target, baseline, [...hashes.keys()]],
    );
    for (const { data } of changes.rows)
      if (data.deckId !== expectedDeckId || hash(cardContent(data)) !== hashes.get(data.id))
        edited.add(data.id);
    const cards: InsightCard[] = [];
    for (const { data } of result.rows) {
      if (data.deckId !== expectedDeckId || hash(cardContent(data)) !== hashes.get(data.id))
        edited.add(data.id);
      if (!edited.has(data.id))
        cards.push({
          id: data.id,
          deckId: expectedDeckId,
          deckName: row.snapshot.deck.name,
          front: data.front,
          back: data.back,
        });
    }
    return { cards, edited };
  }

  private async insightsFor(
    tx: Transaction,
    target: string,
    cards: InsightCard[],
    query: InsightQuery,
    excluded = 0,
  ): Promise<RecallInsights> {
    const selected = cards.filter(
      (card) =>
        (!query.deckId || card.deckId === query.deckId) &&
        (!query.cardId || card.id === query.cardId),
    );
    const reviews = await tx.query<{ data: ReviewEvent }>(
      'SELECT data FROM recollect.review_events WHERE owner_id=$1 AND card_id=ANY($2::uuid[])',
      [target, selected.map((card) => card.id)],
    );
    const result = buildRecallInsights({
      cards: selected,
      reviews: reviews.rows.map(({ data }) => data),
      days: query.days,
      timezone: query.timezone,
    });
    return recallInsightsSchema.parse({ ...result, excludedEditedCardCount: excluded });
  }

  async ownInsights(owner: string, input: unknown): Promise<RecallInsights> {
    const query = parseQuery(input);
    return transaction(this.db, async (tx) => {
      await lockOwner(tx, owner);
      const result = await tx.query<{ data: Card; deck_name: string }>(
        `SELECT c.data,d.data->>'name' AS deck_name FROM recollect.cards c JOIN recollect.decks d ON d.owner_id=c.owner_id AND d.id=c.deck_id
         WHERE c.owner_id=$1 AND c.data->>'deletedAt' IS NULL AND d.data->>'deletedAt' IS NULL`,
        [owner],
      );
      return this.insightsFor(
        tx,
        owner,
        result.rows.map(({ data, deck_name }) => ({
          id: data.id,
          deckId: data.deckId,
          deckName: deck_name,
          front: data.front,
          back: data.back,
        })),
        query,
      );
    });
  }

  async shareInsights(
    owner: string,
    id: string,
    target: string,
    input: unknown,
  ): Promise<RecallInsights> {
    const query = parseQuery(input, true);
    return transaction(this.db, async (tx) => {
      const row = await this.lockedShare(tx, owner, id);
      if (!row.accepted_at || (target !== row.sender_id && target !== row.recipient_id))
        return notFound();
      const enabled =
        target === row.sender_id ? row.sender_shares_progress : row.recipient_shares_progress;
      if (owner !== target && !enabled)
        throw new DomainError(
          'progress_private',
          'Your friend has not shared progress for this deck.',
          403,
        );
      await lockOwner(tx, target);
      const scope = await this.scopedCards(tx, row, target);
      return this.insightsFor(
        tx,
        target,
        scope.cards,
        query,
        query.cardId ? Number(scope.edited.has(query.cardId)) : scope.edited.size,
      );
    });
  }

  async friendInsights(owner: string, friend: string, input: unknown): Promise<RecallInsights> {
    const query = parseQuery(input, true);
    return transaction(this.db, async (tx) => {
      await this.lockFriend(tx, owner, friend);
      await lockOwner(tx, friend);
      const shares = await tx.query<ShareRow>(
        `SELECT * FROM recollect.deck_shares WHERE accepted_at IS NOT NULL AND revoked_at IS NULL
         AND ((sender_id=$1 AND recipient_id=$2 AND sender_shares_progress=true)
           OR (sender_id=$2 AND recipient_id=$1 AND recipient_shares_progress=true)) ORDER BY id FOR UPDATE`,
        [friend, owner],
      );
      const cards = new Map<string, InsightCard>(),
        edited = new Set<string>();
      for (const row of shares.rows) {
        const scope = await this.scopedCards(tx, row, friend);
        scope.cards.forEach((card) => cards.set(card.id, card));
        scope.edited.forEach((id) => edited.add(id));
      }
      // A newer valid snapshot can intentionally share previously edited content.
      for (const id of cards.keys()) edited.delete(id);
      return this.insightsFor(
        tx,
        friend,
        [...cards.values()],
        query,
        query.cardId ? Number(edited.has(query.cardId)) : edited.size,
      );
    });
  }
}
