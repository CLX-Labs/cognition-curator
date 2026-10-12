import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationRequestSchema, type Deck, type GenerationJob } from '@recollect/contracts';
import { Repository } from '../src/repository';
import { TestDatabase } from './sqlite';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
import {
  answerForQuestion,
  answerRequestLabel,
  fetchGeneration,
  prepareGeneration,
  type GenerationWorkflow,
} from '../src/generation';

const databases: TestDatabase[] = [];
it('marks a failed saved answer request as paused, then generating only while a retry runs', () => {
  expect(answerRequestLabel(true, false, 'Connection failed')).toBe('Answer request paused');
  expect(answerRequestLabel(true, true, null)).toBe('Generating answer…');
  expect(answerRequestLabel(true, false, null)).toBe('Generating answer…');
  expect(answerRequestLabel(false, false, null)).toBe('Generate answer');
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = new TestDatabase();
  databases.push(db);
  const repo = new Repository(db, randomUUID(), randomUUID(), randomUUID);
  await repo.initialize();
  const deck = {
    id: randomUUID(),
    name: 'Biology',
    description: '',
    color: '#DDE8D9',
    icon: '📚',
    isSilenced: false,
    silencedUntil: null,
  };
  const state: GenerationWorkflow = {
    newDeck: deck,
    request: generationRequestSchema.parse({
      operationId: randomUUID(),
      deckId: deck.id,
      prompt: 'Biology',
      count: 5,
    }),
    job: null,
    drafts: {},
    selectedIds: [],
    acceptance: null,
    accepted: false,
  };
  const canonical: Deck = {
    ...deck,
    ownerId: repo.ownerId,
    version: 1,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { repo, state, canonical };
}

describe('subject decks and answer drafts', () => {
  it('reuses a saved destination and operation after offline retries without duplicate decks', async () => {
    const { repo, state, canonical } = await fixture();
    await repo.setState('generation', state);
    await expect(prepareGeneration(repo, state, async () => undefined)).rejects.toThrow(
      'synchronize',
    );
    const restored = (await repo.getState<GenerationWorkflow>('generation'))!;
    await expect(prepareGeneration(repo, restored, async () => undefined)).rejects.toThrow(
      'synchronize',
    );
    const local = await repo.snapshot();
    expect(local.decks.map((deck) => deck.id)).toEqual([canonical.id]);
    expect(local.pending).toBe(1);
    expect(restored.request.operationId).toBe(state.request.operationId);
    await repo.applyChanges([{ revision: '1', entity: 'deck', data: canonical }], '1');
    await expect(
      prepareGeneration(repo, restored, async () => undefined),
    ).resolves.toBeUndefined();
  });

  it('persists answer results separately from deck drafts and sends the owning account', async () => {
    const { repo, state } = await fixture();
    await repo.setState('generation', state);
    const answerState: GenerationWorkflow = {
      ...state,
      newDeck: undefined,
      sourceQuestion: 'What is ATP?',
      request: { ...state.request, operationId: randomUUID(), count: 1 },
    };
    const job: GenerationJob = {
      id: randomUUID(),
      deckId: state.request.deckId,
      status: 'succeeded',
      prompt: answerState.request.prompt,
      count: 1,
      candidates: [
        {
          id: randomUUID(),
          front: 'What is ATP?',
          back: 'An energy-carrying molecule.',
          hint: '',
          explanation: '',
          tags: [],
        },
      ],
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptedCandidateIds: [],
    };
    request.mockResolvedValue(job);
    const result = await fetchGeneration(repo, answerState, 'answer:new');
    expect(request).toHaveBeenCalledWith('/v1/generations', {
      method: 'POST',
      body: answerState.request,
      ownerId: repo.ownerId,
    });
    expect(await repo.getState('generation')).toEqual(state);
    expect(await repo.getState('answer:new')).toEqual(result);
    expect(answerForQuestion(result, ' What is ATP? ')).toBe(job.candidates[0]!.back);
    expect(answerForQuestion(result, 'What is DNA?')).toBeNull();
    expect((await repo.snapshot()).cards).toHaveLength(0);
    request.mockResolvedValue(job);
    await fetchGeneration(repo, result, 'answer:new');
    expect(request).toHaveBeenLastCalledWith('/v1/generations/' + job.id, {
      ownerId: repo.ownerId,
    });
  });

  it('rejects empty subjects while accepting short titles and each count from five to ten', async () => {
    const { state } = await fixture();
    for (const count of [5, 6, 7, 8, 9, 10]) {
      expect(
        generationRequestSchema.parse({ ...state.request, prompt: 'AI', count }).prompt,
      ).toBe('AI');
    }
    expect(generationRequestSchema.safeParse({ ...state.request, prompt: '  ' }).success).toBe(
      false,
    );
    expect(answerForQuestion({ ...state, sourceQuestion: 'Q' }, 'Q')).toBeNull();
  });
});
