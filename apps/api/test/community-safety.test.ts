import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@recollect/db';
import { assertShareableText, lockCommunityPair } from '../src/community-safety.js';

describe('shared content filtering', () => {
  it('uses the same lock for differently cased UUIDs and reversed participants', async () => {
    const query = vi.fn(async () => ({ rowCount: 2, rows: [] }));
    const tx = { query } as unknown as Transaction;
    const first = 'abcdef00-1234-4000-8000-000000000001',
      second = 'fedcba00-1234-4000-8000-000000000002';
    await lockCommunityPair(tx, first, second);
    const key = query.mock.calls[0];
    query.mockClear();
    await lockCommunityPair(tx, second.toUpperCase(), first.toUpperCase());
    expect(query.mock.calls[0]).toEqual(key);
  });
  it.each([
    'Alternator',
    'Italian greetings',
    'Breast cancer anatomy',
    'World War II',
    'Suicide prevention resources',
  ])('keeps educational subjects available: %s', (text) => {
    expect(() => assertShareableText(text)).not.toThrow();
  });
  it.each([
    'I will kill you',
    'Go kill yourself',
    'CHILD PORNOGRAPHY',
    'How to build a pipe bomb',
    'I will k\u200Bill you',
  ])('rejects targeted threats and exploitative instructions: %s', (text) => {
    expect(() => assertShareableText(text)).toThrow('This content cannot be shared');
  });
});
