import type { WidgetSnapshot } from '../modules/recollect-widget';

interface WidgetAdapter {
  setWidgetOwner(ownerId: string | null): Promise<void>;
  publishWidget(snapshot: WidgetSnapshot | null): Promise<void>;
}
/** Serialize native work so late publishes and clears cannot cross account switches. */
export class WidgetCoordinator {
  private desiredOwner: string | null = null;
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private publishedContent: string | null = null;
  constructor(private readonly adapter: WidgetAdapter) {}
  private queue(work: () => Promise<void>) {
    const next = this.tail.catch(() => undefined).then(work);
    this.tail = next;
    return next;
  }
  setOwner(ownerId: string | null) {
    this.desiredOwner = ownerId;
    this.publishedContent = null;
    const epoch = ++this.epoch;
    return this.queue(async () => {
      if (epoch !== this.epoch) return;
      if (ownerId) await this.adapter.setWidgetOwner(ownerId);
      else await this.adapter.publishWidget(null);
    });
  }
  clearOwner(ownerId: string) {
    if (this.desiredOwner && this.desiredOwner !== ownerId)
      return Promise.reject(new Error('Another account’s widget was preserved.'));
    return this.setOwner(null);
  }
  publish(snapshot: WidgetSnapshot) {
    const epoch = this.epoch;
    return this.queue(async () => {
      if (epoch !== this.epoch || snapshot.ownerId !== this.desiredOwner) return;
      const { updatedAt: _timestamp, ...content } = snapshot;
      const signature = JSON.stringify(content);
      if (this.publishedContent === signature) return;
      await this.adapter.publishWidget(snapshot);
      if (epoch === this.epoch) this.publishedContent = signature;
    });
  }
}
