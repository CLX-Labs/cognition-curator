import type { Card, Deck, ImportRequest, ImportResponse } from '@recollect/contracts';
import {
  appendChanges,
  DomainError,
  hash,
  lockOwner,
  transaction,
  type Change,
  type Database,
} from '@recollect/db';
import { getCard, getDeck, insertCard, saveDeck } from './sync.js';

export async function importDevice(
  db: Database,
  owner: string,
  sessionId: string,
  body: ImportRequest,
): Promise<ImportResponse> {
  if (body.sourceAccountId && body.sourceAccountId !== owner)
    throw new DomainError(
      'ownership_mismatch',
      'The selected source account does not match the signed-in account.',
      403,
    );
  if (!body.ownershipConfirmed)
    throw new DomainError(
      'ownership_confirmation_required',
      'Confirm ownership of the recovery material before importing.',
      409,
    );
  if (Date.parse(body.exportedAt) > Date.now() + 300_000)
    throw new DomainError('clock_in_future', 'Recovery export time is in the future.');
  if (
    new Set(body.decks.map((d) => d.id)).size !== body.decks.length ||
    new Set(body.cards.map((c) => c.id)).size !== body.cards.length
  )
    throw new DomainError('duplicate_manifest_ids', 'Manifest contains duplicate entity IDs.');
  return transaction(db, async (tx) => {
    const head = await lockOwner(tx, owner);
    const fresh = await tx.query(
      "SELECT 1 FROM recollect.sessions s JOIN recollect.session_families f ON f.id=s.family_id WHERE s.id=$1 AND s.owner_id=$2 AND f.revoked_at IS NULL AND f.authenticated_at>now()-interval '15 minutes'",
      [sessionId, owner],
    );
    if (!fresh.rowCount)
      throw new DomainError(
        'reauthentication_required',
        'Sign in again to authorize this recovery import.',
        401,
      );
    const fingerprint = hash(body);
    const prior = (
      await tx.query<{ payload_hash: string; result: ImportResponse }>(
        'SELECT payload_hash,result FROM recollect.import_batches WHERE owner_id=$1 AND batch_id=$2',
        [owner, body.batchId],
      )
    ).rows[0];
    if (prior) {
      if (prior.payload_hash !== fingerprint)
        throw new DomainError('batch_id_reused', 'Recovery batch ID has changed content.', 409);
      return prior.result;
    }
    const changes: Change[] = [],
      now = new Date().toISOString();
    const result: ImportResponse = {
      batchId: body.batchId,
      revision: head.toString(),
      importedDeckIds: [],
      importedCardIds: [],
      conflicts: [],
      manifestHash: fingerprint,
    };
    for (const input of body.decks) {
      const occupied = await tx.query('SELECT 1 FROM recollect.decks WHERE id=$1', [input.id]);
      if (occupied.rowCount) {
        result.conflicts.push({
          entity: 'deck',
          id: input.id,
          reason:
            'Identity already exists; original recovery data is preserved without overwriting it.',
        });
        continue;
      }
      const deck: Deck = {
        ...input,
        ownerId: owner,
        createdAt: body.exportedAt,
        updatedAt: now,
        deletedAt: null,
        version: 1,
      };
      await saveDeck(tx, deck);
      changes.push({ entity: 'deck', data: deck });
      result.importedDeckIds.push(deck.id);
    }
    for (const input of body.cards) {
      const occupied = await tx.query('SELECT 1 FROM recollect.cards WHERE id=$1', [input.id]);
      if (occupied.rowCount) {
        result.conflicts.push({
          entity: 'card',
          id: input.id,
          reason:
            'Identity already exists; reconcile the preserved original instead of overwriting current work.',
        });
        continue;
      }
      const deck = await getDeck(tx, owner, input.deckId);
      if (!deck || deck.deletedAt) {
        result.conflicts.push({
          entity: 'card',
          id: input.id,
          reason: 'Destination is not an active deck owned by this account.',
        });
        continue;
      }
      if (
        Date.parse(input.checkpointAt) > Date.parse(body.exportedAt) ||
        (input.schedule.lastReviewedAt &&
          Date.parse(input.schedule.lastReviewedAt) > Date.parse(input.checkpointAt))
      )
        throw new DomainError(
          'invalid_checkpoint',
          'Checkpoint must include prior reviews and cannot follow the export.',
        );
      const { checkpointAt, ...content } = input;
      const card: Card = {
        ...content,
        ownerId: owner,
        createdAt: body.exportedAt,
        updatedAt: now,
        deletedAt: null,
        version: 1,
      };
      await insertCard(tx, card, checkpointAt);
      changes.push({ entity: 'card', data: card });
      result.importedCardIds.push(card.id);
    }
    if (changes.length) result.revision = await appendChanges(tx, owner, changes);
    // The complete manifest preserves ambiguous records, old units and pending operations for explicit recovery.
    await tx.query(
      'INSERT INTO recollect.import_batches(owner_id,batch_id,payload_hash,source,manifest,result) VALUES($1,$2,$3,$4,$5,$6)',
      [owner, body.batchId, fingerprint, body.source, body, result],
    );
    return result;
  });
}
