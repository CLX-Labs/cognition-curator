import { pullResponseSchema, pushResponseSchema } from '@recollect/contracts';
import type { Repository } from './repository';

export interface Transport {
  request(path: string, options?: { method?: string; body?: unknown }): Promise<unknown>;
}
export class SyncEngine {
  private flight: Promise<void> | null = null;
  private stopped = false;
  constructor(
    private repository: Repository,
    private transport: Transport,
    private changed: () => void,
  ) {}
  stop() {
    this.stopped = true;
  }
  run() {
    if (this.stopped) return Promise.resolve();
    if (this.flight) return this.flight;
    const task = this.synchronize();
    this.flight = task;
    return task.finally(() => {
      if (this.flight === task) this.flight = null;
    });
  }
  private async synchronize() {
    // Push one durable command at a time so acknowledgements can rebase the next
    // unsent edit. Ambiguous network failures retry the exact command identity.
    for (let i = 0; i < 1000 && !this.stopped; i++) {
      const operation = await this.repository.nextOperation();
      if (this.stopped) return;
      if (!operation) break;
      try {
        const response = pushResponseSchema.parse(
          await this.transport.request('/v1/sync/push', {
            method: 'POST',
            body: { operations: [operation] },
          }),
        );
        const receipt = response.receipts.find((r) => r.operationId === operation.operationId);
        if (!receipt) throw new Error('The server did not acknowledge this change.');
        if (this.stopped) return;
        await this.repository.applyReceipt(receipt);
        this.changed();
      } catch (error) {
        await this.repository.recordNetworkFailure(
          operation.operationId,
          error instanceof Error ? error.message : 'Connection interrupted.',
        );
        throw error;
      }
    }
    if (this.stopped) return;
    let cursor = await this.repository.cursor();
    let highWatermark: string | undefined;
    for (let pages = 0; pages < 10_000 && !this.stopped; pages++) {
      const path =
        '/v1/sync/pull?cursor=' +
        encodeURIComponent(cursor) +
        '&limit=100' +
        (highWatermark === undefined ? '' : '&until=' + encodeURIComponent(highWatermark));
      const page = pullResponseSchema.parse(await this.transport.request(path));
      if (this.stopped) return;
      if (highWatermark !== undefined && page.highWatermark !== highWatermark)
        throw new Error('The synchronization snapshot changed unexpectedly.');
      highWatermark = page.highWatermark;
      if (BigInt(page.cursor) < BigInt(cursor))
        throw new Error('The server returned an older synchronization position.');
      if (page.hasMore && page.cursor === cursor)
        throw new Error('The server returned an empty synchronization page.');
      await this.repository.applyChanges(page.changes, page.cursor);
      cursor = page.cursor;
      this.changed();
      if (!page.hasMore) return;
    }
  }
}
