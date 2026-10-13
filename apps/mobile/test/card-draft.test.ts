import { expect, it, vi } from 'vitest';
import type { CardInput } from '@recollect/contracts';
import type { GenerationWorkflow } from '../src/generation';
import { saveCardDraft } from '../src/card-draft';

const input: CardInput = {
  id: 'card-stable-id',
  deckId: 'deck-id',
  front: 'Who wrote Pride and Prejudice?',
  back: 'Jane Austen',
  hint: '',
  explanation: '',
  tags: [],
  aiGenerated: true,
};
const completed = {
  sourceQuestion: input.front,
  job: { status: 'succeeded', candidates: [{ back: input.back }] },
} as GenerationWorkflow;
function repository(state: GenerationWorkflow | null = completed) {
  const values = new Map<string, unknown>([['answer:deck-id:new', state]]);
  const order: string[] = [];
  return {
    values,
    order,
    saveCard: vi.fn(async () => {
      order.push('card');
    }),
    getState: vi.fn(async <T>(key: string) => (values.get(key) ?? null) as T | null),
    setState: vi.fn(async (key: string, value: unknown) => {
      order.push(key);
      values.set(key, value);
    }),
  };
}
it('saves the card before moving its answer workflow and clearing the shared new-card key', async () => {
  const repo = repository();
  await saveCardDraft(repo, input, undefined, 'new');
  expect(repo.order).toEqual(['card', 'answer:deck-id:card-stable-id', 'answer:deck-id:new']);
  expect(repo.values.get('answer:deck-id:card-stable-id')).toBe(completed);
  expect(repo.values.get('answer:deck-id:new')).toBeNull();
});
it('does not clear or move an answer when card storage fails, and retries the same card ID', async () => {
  const repo = repository();
  repo.saveCard.mockRejectedValueOnce(new Error('Disk full'));
  await expect(saveCardDraft(repo, input, undefined, 'new')).rejects.toThrow('Disk full');
  expect(repo.setState).not.toHaveBeenCalled();
  await saveCardDraft(repo, input, undefined, 'new');
  expect(repo.saveCard.mock.calls.map((args) => (args[0] as CardInput).id)).toEqual([
    input.id,
    input.id,
  ]);
});
it('preserves the old workflow if copying it to the saved card fails', async () => {
  const repo = repository();
  repo.setState.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(saveCardDraft(repo, input, undefined, 'new')).rejects.toThrow(
    'Storage unavailable',
  );
  expect(repo.values.get('answer:deck-id:new')).toBe(completed);
  expect(repo.setState).toHaveBeenCalledTimes(1);
});
it('leaves a recoverable copy on the saved card if clearing the old key fails', async () => {
  const repo = repository();
  const set = repo.setState.getMockImplementation()!;
  repo.setState.mockImplementation(async (key, value) => {
    if (key.endsWith(':new')) throw new Error('Storage unavailable');
    await set(key, value);
  });
  await expect(saveCardDraft(repo, input, undefined, 'new')).rejects.toThrow(
    'Storage unavailable',
  );
  expect(repo.values.get('answer:deck-id:new')).toBe(completed);
  expect(repo.values.get('answer:deck-id:card-stable-id')).toBe(completed);
});
it.each([null, { status: 'queued' }, { status: 'running' }])(
  'does not race a pending answer request (%j)',
  async (job) => {
    const pending = { ...completed, job } as GenerationWorkflow;
    const repo = repository(pending);
    await expect(saveCardDraft(repo, input, undefined, 'new')).rejects.toThrow(
      'set its request aside',
    );
    expect(repo.saveCard).not.toHaveBeenCalled();
    expect(repo.setState).not.toHaveBeenCalled();
    expect(repo.values.get('answer:deck-id:new')).toBe(pending);
  },
);
it('keeps an existing card answer at its current key and preserves the edit baseline', async () => {
  const repo = repository();
  repo.values.set('answer:deck-id:card-stable-id', completed);
  const baseline = { ...input, version: 5 } as Parameters<typeof saveCardDraft>[2];
  await saveCardDraft(repo, input, baseline, input.id);
  expect(repo.saveCard).toHaveBeenCalledWith(input, baseline);
  expect(repo.setState).not.toHaveBeenCalled();
});
it('saves manually written cards without an answer workflow', async () => {
  const repo = repository(null);
  await saveCardDraft(repo, input, undefined, 'new');
  expect(repo.saveCard).toHaveBeenCalledWith(input, undefined);
  expect(repo.setState).not.toHaveBeenCalled();
});
