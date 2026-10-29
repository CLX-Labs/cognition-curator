import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultReviewSettingsInput,
  type Card,
  type Category,
  type Deck,
  type ReviewSettings,
  type ReviewSettingsInput,
} from '@recollect/contracts';
import { initialSchedule, reviewSchedule } from '@recollect/scheduler';
import { Repository, deckContent, dueCards, reviewSettingsContent } from '../src/repository';
import { shareSnapshot } from '../src/store-refresh';
import { SyncEngine } from '../src/sync';
import { TestDatabase } from './sqlite';

const at = '2026-10-29T12:00:00.000Z';
const opened: TestDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function database(path?: string) {
  const db = new TestDatabase(path);
  opened.push(db);
  return db;
}
function category(name = 'Jeopardy'): Category {
  return { id: randomUUID(), name, color: '#627A59', reviewEnabled: true, cadence: null };
}
function canonical(input: ReviewSettingsInput, version = 1): ReviewSettings {
  return { ...input, ownerId: input.id, version, createdAt: at, updatedAt: at, deletedAt: null };
}
async function fixture(db = database()) {
  const owner = randomUUID();
  const device = randomUUID();
  const repo = new Repository(db, owner, device, randomUUID, () => at);
  await repo.initialize();
  const deck: Deck = {
    id: randomUUID(),
    ownerId: owner,
    name: 'History',
    description: '',
    color: '#627A59',
    icon: '▤',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const card: Card = {
    id: randomUUID(),
    ownerId: owner,
    deckId: deck.id,
    front: 'Jane Austen',
    back: 'Pride and Prejudice',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: initialSchedule(at),
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  await repo.applyChanges(
    [
      { entity: 'deck', revision: '1', data: deck },
      { entity: 'card', revision: '2', data: card },
    ],
    '2',
  );
  return { repo, db, owner, device, deck, card };
}

describe('durable categories and review settings', () => {
  it('persists offline category edits and assignments across a real SQLite reopen and export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'recollect-categories-'));
    directories.push(dir);
    const path = join(dir, 'library.db');
    const f = await fixture(database(path));
    const group = category();
    await f.repo.saveCategory(group);
    await f.repo.setDeckCategory(f.deck.id, group.id);
    const reopened = new Repository(database(path), f.owner, f.device, randomUUID, () => at);
    await reopened.initialize();
    const state = await reopened.snapshot();
    expect(state.reviewSettings).toMatchObject({
      categories: [group],
      deckCategories: { [f.deck.id]: group.id },
    });
    expect(state.pending).toBe(2);
    expect((await reopened.nextOperation())?.type).toBe('reviewSettings.upsert');
    expect((await reopened.exportData()).reviewSettings).toEqual(state.reviewSettings);
  });

  it('isolates categories by owner and refuses foreign settings or editor baselines', async () => {
    const f = await fixture();
    await f.repo.saveCategory(category());
    const other = new Repository(f.db, randomUUID(), randomUUID(), randomUUID, () => at);
    await other.initialize();
    expect((await other.snapshot()).reviewSettings).toBeNull();
    expect(await other.nextOperation()).toBeNull();
    const foreign = (await f.repo.snapshot()).reviewSettings!;
    await expect(other.saveReviewSettings(reviewSettingsContent(foreign))).rejects.toThrow(
      'different account',
    );
    await expect(
      other.saveReviewSettings(defaultReviewSettingsInput(other.ownerId), foreign),
    ).rejects.toThrow('different account');
    await expect(
      other.applyChanges([{ entity: 'reviewSettings', revision: '3', data: foreign }], '3'),
    ).rejects.toThrow('different account');
  });

  it('removes a category and its assignments without deleting its library or history', async () => {
    const f = await fixture();
    const group = category();
    await f.repo.saveCategory(group);
    await f.repo.setDeckCategory(f.deck.id, group.id);
    await f.repo.rateCard(f.card.id, 'good', 500);
    const before = await f.repo.snapshot();
    await f.repo.removeCategory(group.id);
    const after = await f.repo.snapshot();
    expect(after.reviewSettings?.categories).toEqual([]);
    expect(after.reviewSettings?.deckCategories).toEqual({});
    expect(after.decks).toEqual(before.decks);
    expect(after.cards).toEqual(before.cards);
    expect(after.reviews).toEqual(before.reviews);
  });

  it('rejects invalid assignments and rolls back a deck when its category cannot be saved', async () => {
    const f = await fixture();
    const newDeck = { ...deckContent(f.deck), id: randomUUID() };
    await expect(f.repo.saveDeckInCategory(newDeck, randomUUID())).rejects.toThrow('category');
    expect((await f.repo.snapshot()).decks).toEqual([f.deck]);
    expect((await f.repo.snapshot()).pending).toBe(0);
    const group = category();
    await f.repo.saveCategory(group);
    await expect(f.repo.setDeckCategory(randomUUID(), group.id)).rejects.toThrow('available deck');
    const input = reviewSettingsContent((await f.repo.snapshot()).reviewSettings!);
    input.deckCategories[f.deck.id] = randomUUID();
    await expect(f.repo.saveReviewSettings(input)).rejects.toThrow('existing category');
  });

  it('waits for the acknowledged parent of a deck created atomically inside a category', async () => {
    const f = await fixture();
    const group = category();
    const settings = canonical({ ...defaultReviewSettingsInput(f.owner), categories: [group] });
    await f.repo.applyChanges([{ entity: 'reviewSettings', revision: '3', data: settings }]);
    const input = { ...deckContent(f.deck), id: randomUUID(), name: 'Science' };
    await f.repo.saveDeckInCategory(input, group.id);
    expect((await f.repo.snapshot()).reviewSettings?.deckCategories[input.id]).toBe(group.id);
    const deckOperation = (await f.repo.nextOperation())!;
    expect(deckOperation.type).toBe('deck.upsert');
    await f.repo.applyReceipt({
      operationId: deckOperation.operationId,
      status: 'rejected',
      error: { code: 'blocked', message: 'Fix this deck.' },
    });
    expect(await f.repo.nextOperation()).toBeNull();
    await f.repo.resolveIssue(deckOperation.operationId, 'retry');
    const retry = (await f.repo.nextOperation())!;
    await f.repo.applyReceipt({
      operationId: retry.operationId,
      status: 'accepted',
      canonical: { entity: 'deck', data: { ...f.deck, ...input } },
    });
    expect((await f.repo.nextOperation())?.type).toBe('reviewSettings.upsert');
  });

  it('rebases only acknowledged preceding settings edits, keeps retries stable, and archives conflicts', async () => {
    const f = await fixture();
    const group = category();
    await f.repo.saveCategory(group);
    await f.repo.setDeckCategory(f.deck.id, group.id);
    const first = (await f.repo.nextOperation())!;
    if (first.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    const firstCanonical = canonical(first.payload);
    await f.repo.applyReceipt({
      operationId: first.operationId,
      status: 'accepted',
      canonical: { entity: 'reviewSettings', data: firstCanonical },
    });
    const second = (await f.repo.nextOperation())!;
    if (second.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    expect(second.baseVersion).toBe(1);
    // An ambiguous retry keeps its identity even across a repository reopen.
    const reopened = new Repository(f.db, f.owner, f.device, randomUUID, () => at);
    await reopened.initialize();
    expect(await reopened.nextOperation()).toEqual(second);
    const remote = { ...firstCanonical, version: 2, reviewEnabled: false };
    await reopened.applyReceipt({
      operationId: second.operationId,
      status: 'conflict',
      canonical: { entity: 'reviewSettings', data: remote },
      error: { code: 'version_conflict', message: 'Changed on another device.' },
    });
    expect((await reopened.snapshot()).issues[0]?.canonical).toEqual(remote);
    expect((await reopened.snapshot()).reviewSettings?.deckCategories[f.deck.id]).toBe(group.id);
    await reopened.resolveIssue(second.operationId, 'server');
    expect((await reopened.snapshot()).reviewSettings).toEqual(remote);
    expect((await reopened.exportData()).recoveryCopies.length).toBeGreaterThan(0);
  });

  it('keeps an open settings editor based on its displayed version after a concurrent remote edit', async () => {
    const f = await fixture();
    const shown = canonical(defaultReviewSettingsInput(f.owner));
    await f.repo.applyChanges([{ entity: 'reviewSettings', revision: '3', data: shown }]);
    await f.repo.applyChanges([
      {
        entity: 'reviewSettings',
        revision: '4',
        data: { ...shown, version: 2, reviewEnabled: false },
      },
    ]);
    await f.repo.saveReviewSettings(
      { ...reviewSettingsContent(shown), categories: [category()] },
      shown,
    );
    const operation = await f.repo.nextOperation();
    expect(operation?.type).toBe('reviewSettings.upsert');
    if (operation?.type === 'reviewSettings.upsert') expect(operation.baseVersion).toBe(1);
  });

  async function queuedSettingsEdits() {
    const f = await fixture();
    const group = category();
    const otherGroup = category('Science');
    const otherDeck = { ...f.deck, id: randomUUID(), name: 'Science' };
    await f.repo.applyChanges([{ entity: 'deck', revision: '3', data: otherDeck }]);
    const settings = canonical({
      ...defaultReviewSettingsInput(f.owner),
      categories: [group, otherGroup],
      deckCategories: { [f.deck.id]: group.id, [otherDeck.id]: group.id },
    });
    await f.repo.applyChanges([{ entity: 'reviewSettings', revision: '4', data: settings }]);
    await f.repo.saveCategory({ ...group, name: 'Jeopardy trivia' });
    const first = (await f.repo.nextOperation())!;
    if (first.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    const displayed = (await f.repo.snapshot()).reviewSettings!;
    const next = { ...reviewSettingsContent(displayed), reviewEnabled: false };
    const acknowledged = canonical(
      {
        ...first.payload,
        deckCategories: { [otherDeck.id]: group.id },
      },
      2,
    );
    return { ...f, group, otherGroup, otherDeck, first, displayed, next, acknowledged };
  }

  it('rebases an unsent own edit when the server only prunes a deleted deck assignment', async () => {
    const f = await queuedSettingsEdits();
    await f.repo.saveReviewSettings(f.next, f.displayed);
    await f.repo.applyReceipt({
      operationId: f.first.operationId,
      status: 'accepted',
      canonical: { entity: 'reviewSettings', data: f.acknowledged },
    });
    const second = (await f.repo.nextOperation())!;
    if (second.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    expect(second.baseVersion).toBe(2);
    expect(second.payload.reviewEnabled).toBe(false);
    await f.repo.applyReceipt({
      operationId: second.operationId,
      status: 'accepted',
      canonical: {
        entity: 'reviewSettings',
        data: { ...f.acknowledged, reviewEnabled: false, version: 3 },
      },
    });
    expect((await f.repo.snapshot()).pending).toBe(0);
    expect((await f.repo.snapshot()).issues).toEqual([]);
  });

  it.each([
    'global gate',
    'category contents',
    'cadence',
    'added membership',
    'changed membership',
  ] as const)('does not excuse %s changes alongside a pruned assignment', async (change) => {
    const f = await queuedSettingsEdits();
    await f.repo.saveReviewSettings(f.next, f.displayed);
    const acknowledged = structuredClone(f.acknowledged);
    if (change === 'global gate') acknowledged.reviewEnabled = false;
    if (change === 'category contents') acknowledged.categories[0]!.name = 'Changed elsewhere';
    if (change === 'cadence') acknowledged.cadence.goodDays = 10;
    if (change === 'added membership') acknowledged.deckCategories[randomUUID()] = f.group.id;
    if (change === 'changed membership')
      acknowledged.deckCategories[f.otherDeck.id] = f.otherGroup.id;
    await f.repo.applyReceipt({
      operationId: f.first.operationId,
      status: 'accepted',
      canonical: { entity: 'reviewSettings', data: acknowledged },
    });
    const second = (await f.repo.nextOperation())!;
    if (second.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    expect(second.baseVersion).toBe(1);
  });

  it('never advances an attempted dependent even when acknowledgement only prunes an assignment', async () => {
    const f = await queuedSettingsEdits();
    await f.repo.saveReviewSettings(f.next, f.displayed);
    await f.db.run('UPDATE outbox SET attempts=1 WHERE owner=? AND depends_on=?', [
      f.owner,
      f.first.operationId,
    ]);
    await f.repo.applyReceipt({
      operationId: f.first.operationId,
      status: 'accepted',
      canonical: { entity: 'reviewSettings', data: f.acknowledged },
    });
    const second = (await f.repo.nextOperation())!;
    if (second.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    expect(second.baseVersion).toBe(1);
  });

  it('does not hide a stale editor assignment to a different category when that deck is pruned', async () => {
    const f = await queuedSettingsEdits();
    const stale = {
      ...f.displayed,
      deckCategories: { ...f.displayed.deckCategories, [f.deck.id]: f.otherGroup.id },
    };
    await f.repo.saveReviewSettings(f.next, stale);
    await f.repo.applyReceipt({
      operationId: f.first.operationId,
      status: 'accepted',
      canonical: { entity: 'reviewSettings', data: f.acknowledged },
    });
    const second = (await f.repo.nextOperation())!;
    if (second.type !== 'reviewSettings.upsert') throw new Error('Expected settings');
    expect(second.baseVersion).toBe(1);
  });

  it('captures the category cadence in the immutable review and replays the same schedule after settings change', async () => {
    const f = await fixture();
    const group = {
      ...category(),
      cadence: {
        againDays: 4,
        hardDays: 5,
        goodDays: 10,
        easyDays: 20,
        maxIntervalDays: 100,
        growIntervals: false,
      },
    };
    const settings = canonical({
      ...defaultReviewSettingsInput(f.owner),
      categories: [group],
      deckCategories: { [f.deck.id]: group.id },
    });
    await f.repo.applyChanges([{ entity: 'reviewSettings', revision: '3', data: settings }]);
    const review = await f.repo.rateCard(f.card.id, 'good', 500);
    expect(review.cadence).toEqual(group.cadence);
    const expected = reviewSchedule(f.card.schedule, review);
    expect(expected.intervalSeconds).toBe(10 * 86_400);
    expect((await f.repo.snapshot()).cards[0]?.schedule).toEqual(expected);
    await f.repo.saveReviewSettings(
      { ...reviewSettingsContent(settings), categories: [{ ...group, cadence: null }] },
      settings,
    );
    // Re-materialize the optimistic review over a fresh canonical card.
    await f.repo.applyChanges([{ entity: 'card', revision: '4', data: { ...f.card, version: 2 } }]);
    expect((await f.repo.snapshot()).cards[0]?.schedule).toEqual(expected);
    expect((await f.repo.snapshot()).reviews[0]).toEqual(review);
  });

  it('filters due cards by the global gate, category gate, deck pause, and Uncategorized selector', async () => {
    const f = await fixture();
    const group = category();
    const settings = canonical({
      ...defaultReviewSettingsInput(f.owner),
      categories: [group],
      deckCategories: { [f.deck.id]: group.id },
    });
    const extraDeck = { ...f.deck, id: randomUUID(), name: 'Uncategorized' };
    const extraCard = { ...f.card, id: randomUUID(), deckId: extraDeck.id };
    const state = {
      ...(await f.repo.snapshot()),
      decks: [f.deck, extraDeck],
      cards: [f.card, extraCard],
      reviewSettings: settings,
    };
    expect(dueCards(state, Date.parse(at), group.id)).toEqual([f.card]);
    expect(dueCards(state, Date.parse(at), null)).toEqual([extraCard]);
    expect(dueCards(state, Date.parse(at))).toHaveLength(2);
    expect(
      dueCards({ ...state, reviewSettings: { ...settings, reviewEnabled: false } }, Date.parse(at)),
    ).toEqual([]);
    const paused = { ...settings, categories: [{ ...group, reviewEnabled: false }] };
    expect(dueCards({ ...state, reviewSettings: paused }, Date.parse(at))).toEqual([extraCard]);
    expect(
      dueCards(
        { ...state, decks: [{ ...f.deck, isSilenced: true, silencedUntil: null }, extraDeck] },
        Date.parse(at),
      ),
    ).toEqual([extraCard]);
  });

  it('prunes a locally deleted deck assignment during the next settings save', async () => {
    const f = await fixture();
    const group = category();
    await f.repo.saveCategory(group);
    await f.repo.setDeckCategory(f.deck.id, group.id);
    await f.repo.remove('deck', f.deck.id, f.deck);
    await f.repo.saveCategory({ ...group, name: 'Trivia' });
    expect((await f.repo.snapshot()).reviewSettings?.deckCategories).toEqual({});
  });

  it('keeps settings object identity for idle refreshes and propagates meaningful changes', async () => {
    const f = await fixture();
    await f.repo.saveCategory(category());
    const before = await f.repo.snapshot();
    expect(shareSnapshot(before, await f.repo.snapshot())).toBe(before);
    await f.repo.saveReviewSettings({
      ...reviewSettingsContent(before.reviewSettings!),
      reviewEnabled: false,
    });
    const shared = shareSnapshot(before, await f.repo.snapshot());
    expect(shared).not.toBe(before);
    expect(shared.reviewSettings).not.toBe(before.reviewSettings);
    expect(shared.cards).toBe(before.cards);
    expect(shared.decks).toBe(before.decks);
  });
});

it('migrates a legacy cursor by pulling v2 history once without clearing an offline outbox', async () => {
  const f = await fixture();
  // Replace the fixture v2 cursor with an old installation's v1 cursor.
  await f.db.run('DELETE FROM metadata WHERE owner=? AND key=?', [f.owner, 'cursorV2']);
  await f.db.run('INSERT INTO metadata(owner,key,value) VALUES(?,?,?)', [f.owner, 'cursor', '99']);
  await f.repo.saveCategory(category('Offline work'));
  const offline = (await f.repo.nextOperation())!;
  await f.repo.recordNetworkFailure(offline.operationId, 'Offline');
  const remote = canonical(defaultReviewSettingsInput(f.owner));
  const request = vi.fn(async (path: string) => {
    expect(path).toMatch(/^\/v2\/sync\/pull\?cursor=0&limit=100$/);
    return {
      changes: [{ entity: 'reviewSettings', revision: '3', data: remote }],
      cursor: '99',
      highWatermark: '99',
      hasMore: false,
    };
  });
  const changed = vi.fn();
  await new SyncEngine(f.repo, { request }, changed).run();
  expect(await f.repo.cursor()).toBe('99');
  expect((await f.repo.snapshot()).reviewSettings?.categories[0]?.name).toBe('Offline work');
  expect((await f.repo.snapshot()).pending).toBe(1);
  const reopened = new Repository(f.db, f.owner, f.device, randomUUID, () => at);
  await reopened.initialize();
  expect(await reopened.cursor()).toBe('99');
  expect((await reopened.snapshot()).decks).toEqual([f.deck]);
  expect(changed).toHaveBeenCalledTimes(1);
});
