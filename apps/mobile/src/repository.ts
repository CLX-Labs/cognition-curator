import {
  cardInputSchema,
  deckInputSchema,
  type Card,
  type CardInput,
  type Deck,
  type DeckInput,
  type ReviewEvent,
  type SyncOperation,
} from '@recollect/contracts';
import { initialSchedule, reviewSchedule } from '@recollect/scheduler';

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlExecutor {
  transaction<T>(work: (db: SqlExecutor) => Promise<T>): Promise<T>;
}
type Entity = Deck | Card;
type EntityKind = 'deck' | 'card';
type Row = { data: string };
type OperationRow = {
  sequence: number;
  id: string;
  entity: EntityKind;
  entity_id: string;
  data: string;
  attempts: number;
  next_attempt_at: string;
  status: 'pending' | 'blocked';
  error: string | null;
  canonical: string | null;
  depends_on: string | null;
  base_content: string | null;
};
export type LocalIssue = {
  id: string;
  operation: SyncOperation;
  message: string;
  canonical: Entity | null;
};
export type Receipt = {
  operationId: string;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  revision?: string;
  canonical?: { entity: EntityKind; data: Entity };
  error?: { code: string; message: string };
};
export type Change = {
  revision: string;
  entity: EntityKind | 'review';
  data: Entity | ReviewEvent;
};
export type LocalSnapshot = {
  decks: Deck[];
  cards: Card[];
  reviews: ReviewEvent[];
  pending: number;
  issues: LocalIssue[];
};

const schema = [
  'CREATE TABLE IF NOT EXISTS entities(owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,kind,id));',
  'CREATE TABLE IF NOT EXISTS remote_entities(owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,kind,id));',
  'CREATE TABLE IF NOT EXISTS reviews(owner TEXT NOT NULL, id TEXT NOT NULL, card_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,id));',
  'CREATE TABLE IF NOT EXISTS remote_reviews(owner TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(owner,id));',
  "CREATE TABLE IF NOT EXISTS outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, id TEXT NOT NULL UNIQUE, entity TEXT NOT NULL, entity_id TEXT NOT NULL, data TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, canonical TEXT, depends_on TEXT, base_content TEXT);",
  'CREATE INDEX IF NOT EXISTS outbox_owner ON outbox(owner,status,sequence);',
  'CREATE TABLE IF NOT EXISTS metadata(owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,key));',
  'CREATE TABLE IF NOT EXISTS recovery_archive(owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner,id));',
  'CREATE TABLE IF NOT EXISTS workflow_receipts(owner TEXT NOT NULL, key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,key,id));',
  'PRAGMA user_version=3;',
].join('\n');

/** Installation identity and event sequences share one database lifetime. */
export async function installationDeviceId(db: SqlDatabase, uuid: () => string) {
  await initializeSchema(db);
  return db.transaction(async (tx) => {
    const row = (
      await tx.all<{ value: string }>('SELECT value FROM metadata WHERE owner=? AND key=?', [
        '__installation__',
        'deviceId',
      ])
    )[0];
    if (row) return row.value;
    const id = uuid();
    await tx.run('INSERT INTO metadata(owner,key,value) VALUES(?,?,?)', [
      '__installation__',
      'deviceId',
      id,
    ]);
    return id;
  });
}
async function initializeSchema(db: SqlDatabase) {
  await db.exec(schema);
  const columns = await db.all<{ name: string }>('PRAGMA table_info(outbox)');
  if (!columns.some((column) => column.name === 'depends_on'))
    await db.exec('ALTER TABLE outbox ADD COLUMN depends_on TEXT;');
  if (!columns.some((column) => column.name === 'base_content'))
    await db.exec('ALTER TABLE outbox ADD COLUMN base_content TEXT;');
}

export function deckContent(deck: Deck | DeckInput): DeckInput {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    color: deck.color,
    icon: deck.icon,
    isSilenced: deck.isSilenced,
    silencedUntil: deck.silencedUntil,
  };
}
export function cardContent(card: Card | CardInput): CardInput {
  return {
    id: card.id,
    deckId: card.deckId,
    front: card.front,
    back: card.back,
    hint: card.hint,
    explanation: card.explanation,
    tags: card.tags,
    aiGenerated: card.aiGenerated,
  };
}
function decode<T>(row: Row | undefined): T | undefined {
  return row ? (JSON.parse(row.data) as T) : undefined;
}
function target(operation: SyncOperation): { entity: EntityKind; id: string } {
  return operation.type === 'review.append'
    ? { entity: 'card', id: operation.payload.cardId }
    : { entity: operation.type.startsWith('deck.') ? 'deck' : 'card', id: operation.payload.id };
}

/**
 * Every mutable table is partitioned by verified owner. The remote tables preserve
 * server state; the visible tables replay the durable outbox over that state.
 * A failed request never deletes a user's mutation.
 */
export class Repository {
  constructor(
    readonly db: SqlDatabase,
    readonly ownerId: string,
    readonly deviceId: string,
    private readonly uuid: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  async initialize() {
    await initializeSchema(this.db);
  }
  newId() {
    return this.uuid();
  }
  private async get<T>(
    db: SqlExecutor,
    table: 'entities' | 'remote_entities',
    kind: EntityKind,
    id: string,
  ) {
    const rows = await db.all<Row>(
      'SELECT data FROM ' + table + ' WHERE owner=? AND kind=? AND id=?',
      [this.ownerId, kind, id],
    );
    return decode<T>(rows[0]);
  }
  private async put(
    db: SqlExecutor,
    table: 'entities' | 'remote_entities',
    kind: EntityKind,
    data: Entity,
  ) {
    if (data.ownerId !== this.ownerId)
      throw new Error('The server returned data for a different account.');
    await db.run(
      'INSERT INTO ' +
        table +
        '(owner,kind,id,data) VALUES(?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data',
      [this.ownerId, kind, data.id, JSON.stringify(data)],
    );
  }
  private async enqueue(db: SqlExecutor, operation: SyncOperation, baseline?: Entity) {
    const { entity, id } = target(operation);
    const predecessor =
      (
        await db.all<{ id: string }>(
          'SELECT id FROM outbox WHERE owner=? AND entity=? AND entity_id=? ORDER BY sequence DESC LIMIT 1',
          [this.ownerId, entity, id],
        )
      )[0]?.id ?? null;
    const observed = baseline ?? (await this.get<Entity>(db, 'entities', entity, id));
    const baseContent = observed
      ? JSON.stringify('schedule' in observed ? cardContent(observed) : deckContent(observed))
      : null;
    await db.run(
      'INSERT INTO outbox(owner,id,entity,entity_id,data,next_attempt_at,depends_on,base_content) VALUES(?,?,?,?,?,?,?,?)',
      [
        this.ownerId,
        operation.operationId,
        entity,
        id,
        JSON.stringify(operation),
        this.now(),
        predecessor,
        baseContent,
      ],
    );
  }
  private async materialize(db: SqlExecutor, kind: EntityKind, id: string) {
    let entity = await this.get<Entity>(db, 'remote_entities', kind, id);
    const operations = await db.all<Row>(
      'SELECT data FROM outbox WHERE owner=? AND entity=? AND entity_id=? ORDER BY sequence',
      [this.ownerId, kind, id],
    );
    for (const row of operations) {
      const operation = JSON.parse(row.data) as SyncOperation;
      if (operation.type === 'deck.upsert') {
        entity = {
          ...(entity ?? { ownerId: this.ownerId, createdAt: operation.createdAt, version: 0 }),
          ...operation.payload,
          updatedAt: operation.createdAt,
          deletedAt: null,
        } as Deck;
      } else if (operation.type === 'card.upsert') {
        entity = {
          ...(entity ?? {
            ownerId: this.ownerId,
            createdAt: operation.createdAt,
            version: 0,
            schedule: initialSchedule(operation.createdAt),
          }),
          ...operation.payload,
          updatedAt: operation.createdAt,
          deletedAt: null,
        } as Card;
      } else if (operation.type === 'review.append' && entity && 'schedule' in entity) {
        const confirmed = await db.all<{ id: string }>(
          'SELECT id FROM remote_reviews WHERE owner=? AND id=?',
          [this.ownerId, operation.payload.id],
        );
        if (confirmed.length > 0) continue;
        // An offline event older than a newly pulled server checkpoint must be
        // replayed by the server from history. Keep the event queued and show the
        // latest canonical schedule meanwhile, rather than inventing a result.
        if (
          !entity.schedule.lastReviewedAt ||
          operation.payload.reviewedAt >= entity.schedule.lastReviewedAt
        ) {
          entity = {
            ...entity,
            schedule: reviewSchedule(entity.schedule, {
              rating: operation.payload.rating,
              reviewedAt: operation.payload.reviewedAt,
            }),
            updatedAt: operation.createdAt,
          };
        }
      } else if ((operation.type === 'deck.delete' || operation.type === 'card.delete') && entity) {
        entity = { ...entity, deletedAt: operation.createdAt, updatedAt: operation.createdAt };
      }
    }
    if (entity) await this.put(db, 'entities', kind, entity);
    else
      await db.run('DELETE FROM entities WHERE owner=? AND kind=? AND id=?', [
        this.ownerId,
        kind,
        id,
      ]);
  }
  async saveDeck(input: DeckInput, baseline?: Deck) {
    input = deckInputSchema.parse(deckContent(input));
    await this.db.transaction(async (db) => {
      const old = await this.get<Deck>(db, 'remote_entities', 'deck', input.id);
      await this.enqueue(
        db,
        {
          type: 'deck.upsert',
          operationId: this.uuid(),
          deviceId: this.deviceId,
          createdAt: this.now(),
          baseVersion: baseline?.version ?? old?.version ?? 0,
          payload: deckContent(input),
        },
        baseline,
      );
      await this.materialize(db, 'deck', input.id);
    });
  }
  async saveCard(input: CardInput, baseline?: Card) {
    input = cardInputSchema.parse(cardContent(input));
    await this.db.transaction(async (db) => {
      const deck = await this.get<Deck>(db, 'entities', 'deck', input.deckId);
      if (!deck || deck.deletedAt) throw new Error('Choose an available deck.');
      const old = await this.get<Card>(db, 'remote_entities', 'card', input.id);
      await this.enqueue(
        db,
        {
          type: 'card.upsert',
          operationId: this.uuid(),
          deviceId: this.deviceId,
          createdAt: this.now(),
          baseVersion: baseline?.version ?? old?.version ?? 0,
          payload: cardContent(input),
        },
        baseline,
      );
      await this.materialize(db, 'card', input.id);
    });
  }
  async remove(kind: EntityKind, id: string, baseline?: Entity) {
    await this.db.transaction(async (db) => {
      const old = await this.get<Entity>(db, 'remote_entities', kind, id);
      const base = {
        operationId: this.uuid(),
        deviceId: this.deviceId,
        createdAt: this.now(),
        baseVersion: baseline?.version ?? old?.version ?? 0,
        payload: { id },
      };
      await this.enqueue(
        db,
        kind === 'deck' ? { ...base, type: 'deck.delete' } : { ...base, type: 'card.delete' },
        baseline,
      );
      await this.materialize(db, kind, id);
    });
  }
  async rateCard(
    cardId: string,
    rating: ReviewEvent['rating'],
    elapsedMs: number,
  ): Promise<ReviewEvent> {
    return this.db.transaction(async (db) => {
      const card = await this.get<Card>(db, 'entities', 'card', cardId);
      if (!card || card.deletedAt) throw new Error('This card is no longer available.');
      const sequenceRows = await db.all<{ value: string }>(
        'SELECT value FROM metadata WHERE owner=? AND key=?',
        [this.ownerId, 'deviceSequence'],
      );
      const sequence = Number(sequenceRows[0]?.value ?? '0') + 1;
      await db.run(
        'INSERT INTO metadata(owner,key,value) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value',
        [this.ownerId, 'deviceSequence', String(sequence)],
      );
      const reviewedAt = this.now();
      const event: ReviewEvent = {
        id: this.uuid(),
        cardId,
        deckId: card.deckId,
        deviceId: this.deviceId,
        deviceSequence: sequence,
        rating,
        reviewedAt,
        elapsedMs: Math.min(86_400_000, Math.max(0, Math.round(elapsedMs))),
        algorithmVersion: 'sm2-v1',
      };
      await db.run('INSERT INTO reviews(owner,id,card_id,data) VALUES(?,?,?,?)', [
        this.ownerId,
        event.id,
        cardId,
        JSON.stringify(event),
      ]);
      await this.enqueue(db, {
        type: 'review.append',
        operationId: this.uuid(),
        deviceId: this.deviceId,
        createdAt: reviewedAt,
        payload: event,
      });
      await this.materialize(db, 'card', cardId);
      return event;
    });
  }
  async snapshot(): Promise<LocalSnapshot> {
    const rows = await this.db.all<{ kind: EntityKind; data: string }>(
      'SELECT kind,data FROM entities WHERE owner=?',
      [this.ownerId],
    );
    const decks = rows
      .filter((r) => r.kind === 'deck')
      .map((r) => JSON.parse(r.data) as Deck)
      .filter((d) => !d.deletedAt);
    const deckIds = new Set(decks.map((d) => d.id));
    const cards = rows
      .filter((r) => r.kind === 'card')
      .map((r) => JSON.parse(r.data) as Card)
      .filter((c) => !c.deletedAt && deckIds.has(c.deckId));
    const reviews = (
      await this.db.all<Row>('SELECT data FROM reviews WHERE owner=?', [this.ownerId])
    ).map((r) => JSON.parse(r.data) as ReviewEvent);
    const pending =
      (
        await this.db.all<{ n: number }>(
          'SELECT COUNT(*) AS n FROM outbox WHERE owner=? AND status=?',
          [this.ownerId, 'pending'],
        )
      )[0]?.n ?? 0;
    const blocked = await this.db.all<OperationRow>(
      'SELECT * FROM outbox WHERE owner=? AND status=? ORDER BY sequence',
      [this.ownerId, 'blocked'],
    );
    const issues = blocked.map((r) => ({
      id: r.id,
      operation: JSON.parse(r.data) as SyncOperation,
      message: r.error ?? 'This change needs your attention.',
      canonical: r.canonical ? (JSON.parse(r.canonical) as Entity) : null,
    }));
    return { decks, cards, reviews, pending, issues };
  }
  /** Freeze command contents before network I/O. Retried attempts keep their ID and payload. */
  async nextOperation(): Promise<SyncOperation | null> {
    return this.db.transaction(async (db) => {
      const rows = await db.all<OperationRow>(
        'SELECT * FROM outbox o WHERE owner=? AND status=? AND next_attempt_at<=? AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.owner=o.owner AND p.entity=o.entity AND p.entity_id=o.entity_id AND p.sequence<o.sequence) ORDER BY sequence',
        [this.ownerId, 'pending', this.now()],
      );
      let row: OperationRow | undefined;
      for (const candidate of rows) {
        if (candidate.entity === 'card') {
          const card = await this.get<Card>(db, 'entities', 'card', candidate.entity_id);
          if (card) {
            const parents = await db.all<{ n: number }>(
              'SELECT COUNT(*) AS n FROM outbox WHERE owner=? AND entity=? AND entity_id=? AND sequence<?',
              [this.ownerId, 'deck', card.deckId, candidate.sequence],
            );
            if ((parents[0]?.n ?? 0) > 0) continue;
          }
        }
        row = candidate;
        break;
      }
      if (!row) return null;
      const op = JSON.parse(row.data) as SyncOperation;
      await db.run('UPDATE outbox SET attempts=attempts+1 WHERE owner=? AND id=?', [
        this.ownerId,
        row.id,
      ]);
      return op;
    });
  }
  async recordNetworkFailure(operationId: string, message: string) {
    const rows = await this.db.all<OperationRow>('SELECT * FROM outbox WHERE owner=? AND id=?', [
      this.ownerId,
      operationId,
    ]);
    const row = rows[0];
    if (!row) return;
    const delay = Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8));
    await this.db.run('UPDATE outbox SET next_attempt_at=?,error=? WHERE owner=? AND id=?', [
      new Date(new Date(this.now()).getTime() + delay).toISOString(),
      message,
      this.ownerId,
      operationId,
    ]);
  }
  async applyReceipt(receipt: Receipt) {
    await this.db.transaction(async (db) => {
      const rows = await db.all<OperationRow>('SELECT * FROM outbox WHERE owner=? AND id=?', [
        this.ownerId,
        receipt.operationId,
      ]);
      const row = rows[0];
      if (!row) return;
      if (receipt.canonical) {
        const previous = await this.get<Entity>(
          db,
          'remote_entities',
          receipt.canonical.entity,
          receipt.canonical.data.id,
        );
        if (!previous || receipt.canonical.data.version >= previous.version) {
          await this.put(db, 'remote_entities', receipt.canonical.entity, receipt.canonical.data);
        }
      }
      if (receipt.status === 'accepted' || receipt.status === 'duplicate') {
        const operation = JSON.parse(row.data) as SyncOperation;
        if (operation.type === 'review.append')
          await db.run('INSERT OR IGNORE INTO remote_reviews(owner,id) VALUES(?,?)', [
            this.ownerId,
            operation.payload.id,
          ]);
        const dependents = await db.all<OperationRow>(
          'SELECT * FROM outbox WHERE owner=? AND depends_on=?',
          [this.ownerId, receipt.operationId],
        );
        for (const dependent of dependents) {
          const command = JSON.parse(dependent.data) as SyncOperation;
          // Only our acknowledged predecessor may advance this edit's base.
          // A pull from another device must still produce an explicit conflict.
          const receiptContent = receipt.canonical
            ? JSON.stringify(
                receipt.canonical.entity === 'card'
                  ? cardContent(receipt.canonical.data as Card)
                  : deckContent(receipt.canonical.data as Deck),
              )
            : null;
          const contentUnchanged =
            dependent.base_content !== null && dependent.base_content === receiptContent;
          const rebased =
            command.type !== 'review.append' &&
            receipt.canonical &&
            dependent.attempts === 0 &&
            contentUnchanged
              ? { ...command, baseVersion: receipt.canonical.data.version }
              : command;
          await db.run('UPDATE outbox SET data=?,depends_on=NULL WHERE owner=? AND id=?', [
            JSON.stringify(rebased),
            this.ownerId,
            dependent.id,
          ]);
        }
        await db.run('DELETE FROM outbox WHERE owner=? AND id=?', [
          this.ownerId,
          receipt.operationId,
        ]);
      } else {
        await db.run('UPDATE outbox SET status=?,error=?,canonical=? WHERE owner=? AND id=?', [
          'blocked',
          receipt.error?.message ?? receipt.status,
          receipt.canonical ? JSON.stringify(receipt.canonical.data) : null,
          this.ownerId,
          receipt.operationId,
        ]);
      }
      await this.materialize(db, row.entity, row.entity_id);
    });
  }
  async applyChanges(changes: Change[], cursor?: string) {
    await this.db.transaction(async (db) => {
      for (const change of changes) {
        if (change.entity === 'review') {
          const review = change.data as ReviewEvent;
          await db.run('INSERT OR IGNORE INTO remote_reviews(owner,id) VALUES(?,?)', [
            this.ownerId,
            review.id,
          ]);
          await db.run(
            'INSERT INTO reviews(owner,id,card_id,data) VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET data=excluded.data',
            [this.ownerId, review.id, review.cardId, JSON.stringify(review)],
          );
          await this.materialize(db, 'card', review.cardId);
        } else {
          const data = change.data as Entity;
          const previous = await this.get<Entity>(db, 'remote_entities', change.entity, data.id);
          if (!previous || data.version >= previous.version) {
            await this.put(db, 'remote_entities', change.entity, data);
            await this.materialize(db, change.entity, data.id);
          }
        }
      }
      if (cursor !== undefined)
        await db.run(
          'INSERT INTO metadata(owner,key,value) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value',
          [this.ownerId, 'cursor', cursor],
        );
    });
  }
  async cursor() {
    const rows = await this.db.all<{ value: string }>(
      'SELECT value FROM metadata WHERE owner=? AND key=?',
      [this.ownerId, 'cursor'],
    );
    return rows[0]?.value ?? '0';
  }
  async resolveIssue(id: string, action: 'retry' | 'server') {
    await this.db.transaction(async (db) => {
      const row = (
        await db.all<OperationRow>('SELECT * FROM outbox WHERE owner=? AND id=? AND status=?', [
          this.ownerId,
          id,
          'blocked',
        ])
      )[0];
      if (!row) return;
      const local = await this.get<Entity>(db, 'entities', row.entity, row.entity_id);
      await db.run('INSERT INTO recovery_archive(owner,id,data,created_at) VALUES(?,?,?,?)', [
        this.ownerId,
        this.uuid(),
        JSON.stringify({ operation: JSON.parse(row.data), visible: local, error: row.error }),
        this.now(),
      ]);
      if (action === 'server') {
        const all = await db.all<OperationRow>(
          'SELECT * FROM outbox WHERE owner=? AND entity=? AND entity_id=?',
          [this.ownerId, row.entity, row.entity_id],
        );
        await db.run('INSERT INTO recovery_archive(owner,id,data,created_at) VALUES(?,?,?,?)', [
          this.ownerId,
          this.uuid(),
          JSON.stringify({ replacedOperations: all }),
          this.now(),
        ]);
        await db.run('DELETE FROM outbox WHERE owner=? AND entity=? AND entity_id=?', [
          this.ownerId,
          row.entity,
          row.entity_id,
        ]);
      } else {
        const old = JSON.parse(row.data) as SyncOperation;
        const canonical = await this.get<Entity>(db, 'remote_entities', row.entity, row.entity_id);
        const next =
          old.type === 'review.append'
            ? { ...old, operationId: this.uuid() }
            : { ...old, operationId: this.uuid(), baseVersion: canonical?.version ?? 0 };
        await db.run(
          'UPDATE outbox SET id=?,data=?,status=?,attempts=0,next_attempt_at=?,error=NULL,canonical=NULL WHERE owner=? AND id=?',
          [next.operationId, JSON.stringify(next), 'pending', this.now(), this.ownerId, id],
        );
        await db.run('UPDATE outbox SET depends_on=? WHERE owner=? AND depends_on=?', [
          next.operationId,
          this.ownerId,
          id,
        ]);
      }
      await this.materialize(db, row.entity, row.entity_id);
    });
  }
  async getState<T>(key: string): Promise<T | null> {
    const row = (
      await this.db.all<{ value: string }>('SELECT value FROM metadata WHERE owner=? AND key=?', [
        this.ownerId,
        key,
      ])
    )[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }
  async setState(key: string, value: unknown) {
    await this.db.run(
      'INSERT INTO metadata(owner,key,value) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value',
      [this.ownerId, key, JSON.stringify(value)],
    );
  }
  async archive(value: unknown) {
    await this.db.run('INSERT INTO recovery_archive(owner,id,data,created_at) VALUES(?,?,?,?)', [
      this.ownerId,
      this.uuid(),
      JSON.stringify(value),
      this.now(),
    ]);
  }
  /** Canonical accepted cards, reviewed edits, and workflow completion commit together. */
  async completeGeneration<T>(
    cards: Card[],
    edits: CardInput[],
    workflowKey: string,
    operationId: string,
    complete: T,
  ): Promise<T> {
    return this.db.transaction(async (db) => {
      const receipt = (
        await db.all<Row>('SELECT data FROM workflow_receipts WHERE owner=? AND key=? AND id=?', [
          this.ownerId,
          workflowKey,
          operationId,
        ])
      )[0];
      const stored = (
        await db.all<{ value: string }>('SELECT value FROM metadata WHERE owner=? AND key=?', [
          this.ownerId,
          workflowKey,
        ])
      )[0];
      const previousWorkflow = stored
        ? (JSON.parse(stored.value) as {
            accepted?: boolean;
            acceptance?: { operationId?: string };
          })
        : null;
      if (receipt) {
        if (previousWorkflow?.acceptance?.operationId === operationId) {
          await db.run('UPDATE metadata SET value=? WHERE owner=? AND key=?', [
            receipt.data,
            this.ownerId,
            workflowKey,
          ]);
        }
        return JSON.parse(receipt.data) as T;
      }
      if (previousWorkflow?.accepted && previousWorkflow.acceptance?.operationId === operationId)
        return JSON.parse(stored!.value) as T;
      for (const card of cards) {
        const previous = await this.get<Card>(db, 'remote_entities', 'card', card.id);
        if (!previous || card.version >= previous.version)
          await this.put(db, 'remote_entities', 'card', card);
        const edit = edits.find((candidate) => candidate.id === card.id);
        if (edit) {
          // The user reviewed the acceptance version. A newer remote card must
          // conflict instead of being overwritten by a delayed acceptance.
          await this.enqueue(
            db,
            {
              type: 'card.upsert',
              operationId: this.uuid(),
              deviceId: this.deviceId,
              createdAt: this.now(),
              baseVersion: card.version,
              payload: cardContent(edit),
            },
            card,
          );
        }
        await this.materialize(db, 'card', card.id);
      }
      if (previousWorkflow?.acceptance?.operationId === operationId) {
        await db.run(
          'INSERT INTO metadata(owner,key,value) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value',
          [this.ownerId, workflowKey, JSON.stringify(complete)],
        );
      }
      await db.run('INSERT INTO workflow_receipts(owner,key,id,data) VALUES(?,?,?,?)', [
        this.ownerId,
        workflowKey,
        operationId,
        JSON.stringify(complete),
      ]);
      return complete;
    });
  }
  async exportData() {
    const snapshot = await this.snapshot();
    const pendingOperations = (
      await this.db.all<Row>('SELECT data FROM outbox WHERE owner=? ORDER BY sequence', [
        this.ownerId,
      ])
    ).map((r) => JSON.parse(r.data));
    const recoveryCopies = (
      await this.db.all<Row>(
        'SELECT data FROM recovery_archive WHERE owner=? ORDER BY created_at',
        [this.ownerId],
      )
    ).map((r) => JSON.parse(r.data));
    const workflows = (
      await this.db.all<{ key: string; value: string }>(
        'SELECT key,value FROM metadata WHERE owner=? AND key NOT IN (?,?)',
        [this.ownerId, 'deviceSequence', 'cursor'],
      )
    ).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
    const workflowReceipts = (
      await this.db.all<Row>('SELECT data FROM workflow_receipts WHERE owner=?', [this.ownerId])
    ).map((row) => JSON.parse(row.data));
    return {
      format: 'recollect-portable',
      version: 1,
      ownerId: this.ownerId,
      exportedAt: this.now(),
      ...snapshot,
      pendingOperations,
      recoveryCopies,
      workflows,
      workflowReceipts,
    };
  }
}

export function activeDeck(deck: Deck, now = Date.now()) {
  return (
    !deck.deletedAt &&
    (!deck.isSilenced ||
      (deck.silencedUntil !== null && new Date(deck.silencedUntil).getTime() <= now))
  );
}
export function dueCards(snapshot: Pick<LocalSnapshot, 'decks' | 'cards'>, now = Date.now()) {
  const enabled = new Set(snapshot.decks.filter((d) => activeDeck(d, now)).map((d) => d.id));
  return snapshot.cards
    .filter((c) => enabled.has(c.deckId) && new Date(c.schedule.dueAt).getTime() <= now)
    .sort(
      (a, b) =>
        a.schedule.dueAt.localeCompare(b.schedule.dueAt) || a.createdAt.localeCompare(b.createdAt),
    );
}
