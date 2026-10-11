import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Card, Deck } from '@recollect/contracts';
import { initialSchedule, reviewSchedule } from '@recollect/scheduler';
import { Repository, cardContent, deckContent, installationDeviceId } from '../src/repository';
import { TestDatabase } from './sqlite';

const timestamp = '2026-10-11T12:00:00.000Z';
const databases: TestDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function database(path?: string) {
  const db = new TestDatabase(path);
  databases.push(db);
  return db;
}
async function fixture(db = database()) {
  let time = timestamp;
  const owner = randomUUID();
  const device = await installationDeviceId(db, randomUUID);
  const repo = new Repository(db, owner, device, randomUUID, () => time);
  await repo.initialize();
  const deck: Deck = {
    id: randomUUID(),
    ownerId: owner,
    name: 'Biology',
    description: '',
    color: '#627A59',
    icon: '▤',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  const card: Card = {
    id: randomUUID(),
    ownerId: owner,
    deckId: deck.id,
    front: 'What is ATP?',
    back: 'An energy-carrying molecule.',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: initialSchedule(timestamp),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await repo.applyChanges(
    [
      { revision: '1', entity: 'deck', data: deck },
      { revision: '2', entity: 'card', data: card },
    ],
    '2',
  );
  return {
    repo,
    db,
    deck,
    card,
    owner,
    device,
    advance: (ms: number) => {
      time = new Date(Date.parse(time) + ms).toISOString();
    },
  };
}

describe('durable owner-isolated SQLite repository', () => {
  it('persists review, scheduling, sequence and outbox together across reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'recollect-mobile-'));
    directories.push(directory);
    const path = join(directory, 'library.db');
    const db = database(path);
    const f = await fixture(db);
    const event = await f.repo.rateCard(f.card.id, 'good', 2345);
    const reopened = new Repository(database(path), f.owner, f.device, randomUUID, () => timestamp);
    await reopened.initialize();
    const state = await reopened.snapshot();
    expect(state.reviews).toEqual([event]);
    expect(state.cards[0]?.schedule.totalReviews).toBe(1);
    expect(state.pending).toBe(1);
    expect((await reopened.nextOperation())?.payload).toEqual(event);
    expect((await reopened.rateCard(f.card.id, 'good', 99)).deviceSequence).toBe(2);
  });
  it('rolls back review history and sequence if the durable outbox cannot be written', async () => {
    const { repo, db, card } = await fixture();
    db.failOn = 'INSERT INTO outbox';
    await expect(repo.rateCard(card.id, 'easy', 100)).rejects.toThrow('disk write');
    const state = await repo.snapshot();
    expect(state.reviews).toHaveLength(0);
    expect(state.pending).toBe(0);
    expect(state.cards[0]?.schedule.totalReviews).toBe(0);
    expect((await repo.rateCard(card.id, 'easy', 100)).deviceSequence).toBe(1);
  });
  it('keeps installation device identity with the database, including reinstall reset', async () => {
    const first = database();
    const a = await installationDeviceId(first, randomUUID);
    expect(await installationDeviceId(first, randomUUID)).toBe(a);
    expect(await installationDeviceId(database(), randomUUID)).not.toBe(a);
  });
  it('partitions content, commands, recovery state and sequence by authenticated owner', async () => {
    const f = await fixture();
    await f.repo.saveCard({ ...cardContent(f.card), back: 'Owner A edit' });
    await f.repo.setState('generation', { private: 'owner A draft' });
    const other = new Repository(f.db, randomUUID(), f.device, randomUUID);
    await other.initialize();
    expect(await other.snapshot()).toEqual({
      cards: [],
      decks: [],
      reviews: [],
      pending: 0,
      issues: [],
    });
    expect(await other.nextOperation()).toBeNull();
    expect(await other.getState('generation')).toBeNull();
    await expect(
      other.applyChanges([{ revision: '3', entity: 'card', data: f.card }], '3'),
    ).rejects.toThrow('different account');
    expect(await other.cursor()).toBe('0');
  });
  it('does not rebase an unsent stale edit over a pull from another device', async () => {
    const { repo, card } = await fixture();
    await repo.saveCard({ ...cardContent(card), back: 'My offline edit' });
    await repo.applyChanges(
      [{ revision: '3', entity: 'card', data: { ...card, back: 'Other device edit', version: 2 } }],
      '3',
    );
    const command = await repo.nextOperation();
    expect(command?.type).toBe('card.upsert');
    if (command?.type === 'card.upsert') expect(command.baseVersion).toBe(1);
    expect((await repo.snapshot()).cards[0]?.back).toBe('My offline edit');
  });
  it('retries an ambiguous request with exactly the original key and payload after restart', async () => {
    const f = await fixture();
    await f.repo.saveCard({ ...cardContent(f.card), back: 'Saved offline' });
    const first = await f.repo.nextOperation();
    await f.repo.recordNetworkFailure(first!.operationId, 'Response lost');
    expect(await f.repo.nextOperation()).toBeNull();
    await f.repo.applyChanges([{ revision: '3', entity: 'card', data: { ...f.card, version: 2 } }]);
    f.advance(5000);
    expect(await f.repo.nextOperation()).toEqual(first);
  });
  it('rebases a dependent local edit only to its acknowledged predecessor version', async () => {
    const { repo, card } = await fixture();
    await repo.saveCard({ ...cardContent(card), front: 'First local edit' });
    await repo.saveCard({ ...cardContent(card), front: 'Second local edit' });
    const first = (await repo.nextOperation())!;
    // Pull a later external change before the lost acknowledgement is retried.
    await repo.applyChanges([
      { revision: '5', entity: 'card', data: { ...card, front: 'External edit', version: 3 } },
    ]);
    await repo.applyReceipt({
      operationId: first.operationId,
      status: 'duplicate',
      revision: '3',
      canonical: { entity: 'card', data: { ...card, front: 'First local edit', version: 2 } },
    });
    const second = await repo.nextOperation();
    if (second?.type !== 'card.upsert') throw new Error('Expected pending edit');
    expect(second.baseVersion).toBe(2); // version 3 must conflict; do not silently overwrite it.
    expect(second.payload.front).toBe('Second local edit');
    await repo.applyReceipt({
      operationId: second.operationId,
      status: 'conflict',
      canonical: { entity: 'card', data: { ...card, front: 'External edit', version: 3 } },
      error: { code: 'version_conflict', message: 'Review both versions.' },
    });
    expect((await repo.snapshot()).issues).toHaveLength(1);
  });
  it('skips optimistic review replay when a pull proves a lost-ack event was already accepted', async () => {
    const { repo, card } = await fixture();
    const event = await repo.rateCard(card.id, 'good', 900);
    const pending = (await repo.nextOperation())!;
    await repo.recordNetworkFailure(pending.operationId, 'Lost response');
    const canonical = { ...card, version: 2, schedule: reviewSchedule(card.schedule, event) };
    // Exercise card-before-event ordering within a whole revision.
    await repo.applyChanges(
      [
        { revision: '3', entity: 'card', data: canonical },
        { revision: '3', entity: 'review', data: event },
      ],
      '3',
    );
    const state = await repo.snapshot();
    expect(state.cards[0]?.schedule).toEqual(canonical.schedule);
    expect(state.cards[0]?.schedule.totalReviews).toBe(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.pending).toBe(1); // original receipt still needed, event identity retained.
  });
  it('does not hide an intervening content edit when a review predecessor is acknowledged', async () => {
    const { repo, card } = await fixture();
    const event = await repo.rateCard(card.id, 'good', 900);
    await repo.saveCard({ ...cardContent(card), front: 'My offline question' });
    const review = (await repo.nextOperation())!;
    const canonical = {
      ...card,
      front: 'Another device question',
      version: 3,
      schedule: reviewSchedule(card.schedule, event),
    };
    await repo.applyReceipt({
      operationId: review.operationId,
      status: 'accepted',
      revision: '4',
      canonical: { entity: 'card', data: canonical },
    });
    const edit = await repo.nextOperation();
    if (edit?.type !== 'card.upsert') throw new Error('Expected edit');
    expect(edit.baseVersion).toBe(1);
    expect(edit.payload.front).toBe('My offline question');
  });
  it('retains the editor baseline when a newer card arrives while a form is open', async () => {
    const { repo, card } = await fixture();
    await repo.applyChanges([
      {
        revision: '3',
        entity: 'card',
        data: { ...card, front: 'New server question', version: 2 },
      },
    ]);
    await repo.saveCard({ ...cardContent(card), front: 'Question typed into the old form' }, card);
    const operation = await repo.nextOperation();
    if (operation?.type !== 'card.upsert') throw new Error('Expected edit');
    expect(operation.baseVersion).toBe(1);
  });
  it('commits accepted AI cards, reviewed edits and completion atomically and never re-enqueues them', async () => {
    const { repo, db, card } = await fixture();
    const generated = { ...card, id: randomUUID(), front: 'Generated question', aiGenerated: true };
    const edit = { ...cardContent(generated), front: 'Reviewed question' };
    const acceptance = { operationId: randomUUID() };
    await repo.setState('generation', { acceptance, accepted: false });
    db.failOn = 'INSERT INTO metadata';
    await expect(
      repo.completeGeneration([generated], [edit], 'generation', acceptance.operationId, {
        acceptance,
        accepted: true,
      }),
    ).rejects.toThrow('disk write');
    expect((await repo.snapshot()).cards).toHaveLength(1);
    expect((await repo.snapshot()).pending).toBe(0);
    expect(await repo.getState('generation')).toEqual({ acceptance, accepted: false });
    await repo.completeGeneration([generated], [edit], 'generation', acceptance.operationId, {
      acceptance,
      accepted: true,
    });
    const operation = (await repo.nextOperation())!;
    await repo.applyReceipt({
      operationId: operation.operationId,
      status: 'accepted',
      canonical: { entity: 'card', data: { ...generated, ...edit, version: 2 } },
    });
    await repo.applyChanges([
      {
        revision: '5',
        entity: 'card',
        data: { ...generated, front: 'Another device improved it', version: 3 },
      },
    ]);
    // A stale screen can persist its pending UI state after the first commit.
    // The independent receipt still prevents a second mutation and repairs it.
    await repo.setState('generation', { acceptance, accepted: false });
    await repo.completeGeneration([generated], [edit], 'generation', acceptance.operationId, {
      acceptance,
      accepted: true,
    });
    expect((await repo.snapshot()).pending).toBe(0);
    expect((await repo.snapshot()).cards.find((value) => value.id === generated.id)?.front).toBe(
      'Another device improved it',
    );
    expect(await repo.getState('generation')).toEqual({ acceptance, accepted: true });
  });
  it('waits for a new parent deck before sending its child and preserves blocked work', async () => {
    const { repo, deck } = await fixture();
    const newDeck = { ...deckContent(deck), id: randomUUID(), name: 'Offline deck' };
    await repo.saveDeck(newDeck);
    await repo.saveCard({
      id: randomUUID(),
      deckId: newDeck.id,
      front: 'Question',
      back: 'Answer',
      hint: '',
      explanation: '',
      tags: [],
      aiGenerated: false,
    });
    const parent = (await repo.nextOperation())!;
    expect(parent.type).toBe('deck.upsert');
    await repo.applyReceipt({
      operationId: parent.operationId,
      status: 'rejected',
      error: { code: 'limit', message: 'Resolve deck first.' },
    });
    expect(await repo.nextOperation()).toBeNull();
    expect((await repo.snapshot()).cards).toHaveLength(2);
    await repo.resolveIssue(parent.operationId, 'retry');
    const retry = (await repo.nextOperation())!;
    expect(retry.operationId).not.toBe(parent.operationId);
    await repo.applyReceipt({
      operationId: retry.operationId,
      status: 'accepted',
      canonical: { entity: 'deck', data: { ...deck, ...newDeck, version: 1 } },
    });
    expect((await repo.nextOperation())?.type).toBe('card.upsert');
  });
  it('archives every replaced local edit before explicit use-server resolution', async () => {
    const { repo, card } = await fixture();
    await repo.saveCard({ ...cardContent(card), front: 'First' });
    await repo.saveCard({ ...cardContent(card), front: 'Second' });
    const operation = (await repo.nextOperation())!;
    await repo.applyReceipt({
      operationId: operation.operationId,
      status: 'conflict',
      canonical: { entity: 'card', data: { ...card, front: 'Server', version: 2 } },
    });
    await repo.resolveIssue(operation.operationId, 'server');
    const state = await repo.snapshot();
    expect(state.pending).toBe(0);
    expect(state.issues).toHaveLength(0);
    expect(state.cards[0]?.front).toBe('Server');
    const exported = await repo.exportData();
    expect(JSON.stringify(exported.recoveryCopies)).toContain('First');
    expect(JSON.stringify(exported.recoveryCopies)).toContain('Second');
  });
  it.each(['deck', 'card'] as const)(
    'keeps a delayed %s deletion anchored to the displayed version after a concurrent pull',
    async (kind) => {
      const { repo, deck, card } = await fixture();
      const displayed = kind === 'deck' ? deck : card;
      const updated =
        kind === 'deck'
          ? { ...deck, name: 'Renamed while confirmation was open', version: 2 }
          : { ...card, front: 'Improved while confirmation was open', version: 2 };
      // The alert is already open; a background pull arrives before confirmation.
      await repo.applyChanges([{ revision: '3', entity: kind, data: updated }], '3');
      await repo.remove(kind, displayed.id, displayed);
      const command = (await repo.nextOperation())!;
      if (command.type !== 'deck.delete' && command.type !== 'card.delete') {
        throw new Error('Expected the confirmed deletion');
      }
      expect(command.baseVersion).toBe(1);
      expect(command.payload.id).toBe(displayed.id);
      await repo.applyReceipt({
        operationId: command.operationId,
        status: 'conflict',
        canonical: { entity: kind, data: updated },
        error: { code: 'version_conflict', message: 'This record changed before confirmation.' },
      });
      expect((await repo.snapshot()).issues[0]?.canonical).toEqual(updated);
      await repo.resolveIssue(command.operationId, 'server');
      const restored = await repo.snapshot();
      expect(
        kind === 'deck'
          ? restored.decks.find((value) => value.id === displayed.id)
          : restored.cards.find((value) => value.id === displayed.id),
      ).toEqual(updated);
    },
  );
  it('keeps a pause mutation based on the displayed deck when a remote rename arrives', async () => {
    const { repo, deck } = await fixture();
    const updated = {
      ...deck,
      name: 'Remote rename',
      description: 'New remote context',
      version: 2,
    };
    await repo.applyChanges([{ revision: '3', entity: 'deck', data: updated }], '3');
    await repo.saveDeck({ ...deckContent(deck), isSilenced: true, silencedUntil: null }, deck);
    const command = await repo.nextOperation();
    if (command?.type !== 'deck.upsert') throw new Error('Expected the pause command');
    expect(command.baseVersion).toBe(1);
    expect(command.payload.isSilenced).toBe(true);
    await repo.applyReceipt({
      operationId: command.operationId,
      status: 'conflict',
      canonical: { entity: 'deck', data: updated },
    });
    expect((await repo.snapshot()).issues[0]?.canonical).toEqual(updated);
  });
});
