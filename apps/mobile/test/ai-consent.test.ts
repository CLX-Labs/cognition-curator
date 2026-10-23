import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Repository } from '../src/repository';
import { TestDatabase } from './sqlite';
import { hasAIConsent, saveAIConsent } from '../src/ai-consent';
import type { GenerationWorkflow } from '../src/generation';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
import { fetchGeneration } from '../src/generation';
const databases: TestDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = new TestDatabase();
  databases.push(db);
  const first = new Repository(db, randomUUID(), randomUUID(), randomUUID);
  const second = new Repository(db, randomUUID(), randomUUID(), randomUUID);
  await first.initialize();
  await second.initialize();
  return { first, second };
}
function workflow(repo: Repository): GenerationWorkflow {
  return {
    request: {
      operationId: repo.newId(),
      deckId: repo.newId(),
      count: 5,
      prompt: 'private deck context',
    },
    job: null,
    drafts: {},
    selectedIds: [],
    acceptance: null,
    accepted: false,
  };
}
it('never submits a first or saved generation request without this account’s explicit permission', async () => {
  const { first, second } = await fixture();
  await saveAIConsent(first, true);
  expect(await hasAIConsent(first)).toBe(true);
  expect(await hasAIConsent(second)).toBe(false);
  await expect(fetchGeneration(second, workflow(second))).rejects.toThrow(
    'Allow sharing with Anthropic',
  );
  expect(request).not.toHaveBeenCalled();
});
it('revoking permission blocks a previously saved request before any provider transfer', async () => {
  const { first } = await fixture();
  const saved = workflow(first);
  await saveAIConsent(first, true);
  await first.setState('generation', saved);
  await saveAIConsent(first, false);
  await expect(fetchGeneration(first, saved)).rejects.toThrow('Allow sharing with Anthropic');
  expect(request).not.toHaveBeenCalled();
  expect(await first.getState('generation')).toEqual(saved);
});
