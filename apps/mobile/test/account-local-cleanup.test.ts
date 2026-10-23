import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Repository, eraseOwnerData } from '../src/repository';
import { TestDatabase } from './sqlite';
import { WidgetCoordinator } from '../src/widget-coordinator';

it('erases every owner-scoped SQLite table, rejects late writes, and preserves another account', async () => {
  const db = new TestDatabase();
  try {
    const deleted = new Repository(db, randomUUID(), randomUUID(), randomUUID);
    const kept = new Repository(db, randomUUID(), randomUUID(), randomUUID);
    await deleted.initialize();
    await kept.initialize();
    for (const repo of [deleted, kept]) {
      await repo.saveDeck({
        id: repo.newId(),
        name: 'Personal cards',
        description: '',
        color: '#000000',
        icon: '',
        isSilenced: false,
        silencedUntil: null,
      });
      await repo.setState('profile', { name: 'Private name' });
      await repo.archive({ private: true });
      await db.run(
        'INSERT INTO remote_entities(owner,kind,id,data) SELECT owner,kind,id,data FROM entities WHERE owner=?',
        [repo.ownerId],
      );
      await db.run('INSERT INTO reviews(owner,id,card_id,data) VALUES(?,?,?,?)', [
        repo.ownerId,
        repo.newId(),
        repo.newId(),
        '{}',
      ]);
      await db.run('INSERT INTO remote_reviews(owner,id) VALUES(?,?)', [
        repo.ownerId,
        repo.newId(),
      ]);
      await db.run('INSERT INTO workflow_receipts(owner,key,id,data) VALUES(?,?,?,?)', [
        repo.ownerId,
        'receipt',
        repo.newId(),
        '{}',
      ]);
    }
    deleted.retire();
    await eraseOwnerData(db, deleted.ownerId);
    await expect(deleted.setState('profile', { name: 'Late network response' })).rejects.toThrow(
      'closed',
    );
    for (const table of [
      'entities',
      'remote_entities',
      'reviews',
      'remote_reviews',
      'outbox',
      'metadata',
      'recovery_archive',
      'workflow_receipts',
    ]) {
      expect(
        (
          await db.all<{ count: number }>(
            'SELECT COUNT(*) AS count FROM ' + table + ' WHERE owner=?',
            [deleted.ownerId],
          )
        )[0]!.count,
      ).toBe(0);
      expect(
        (
          await db.all<{ count: number }>(
            'SELECT COUNT(*) AS count FROM ' + table + ' WHERE owner=?',
            [kept.ownerId],
          )
        )[0]!.count,
      ).toBeGreaterThan(0);
    }
    expect((await kept.snapshot()).decks[0]?.name).toBe('Personal cards');
  } finally {
    db.close();
  }
});
it('does not clear a newly signed-in different account’s widget', async () => {
  const calls: unknown[] = [];
  const widgets = new WidgetCoordinator({
    setWidgetOwner: async (owner) => {
      calls.push(owner);
    },
    publishWidget: async (snapshot) => {
      calls.push(snapshot);
    },
  });
  await widgets.setOwner('new-owner');
  await expect(widgets.clearOwner('deleted-owner')).rejects.toThrow('preserved');
  expect(calls).toEqual(['new-owner']);
});
it('drains an already issued metadata write before wiping, so a delayed response cannot repopulate it', async () => {
  const db = new TestDatabase();
  try {
    const repo = new Repository(db, randomUUID(), randomUUID(), randomUUID);
    await repo.initialize();
    const original = db.run;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.run = async (sql, params) => {
      if (sql.startsWith('INSERT INTO metadata')) {
        started();
        await held;
      }
      await original(sql, params);
    };
    const lateWrite = repo.setState('profile', { private: true });
    await entered;
    let drained = false;
    const shutdown = repo.retireAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await lateWrite;
    await shutdown;
    await eraseOwnerData(db, repo.ownerId);
    expect(await db.all('SELECT * FROM metadata WHERE owner=?', [repo.ownerId])).toEqual([]);
    await expect(repo.setState('profile', { late: true })).rejects.toThrow('closed');
  } finally {
    db.close();
  }
});
