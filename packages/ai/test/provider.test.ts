import { describe, expect, it } from 'vitest';
import { AnthropicProvider, ProviderError } from '../src/index.js';
describe('Anthropic provider boundary', () => {
  it('rejects provider content with the wrong count instead of returning fake cards', async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', name: 'emit_flashcards', input: { cards: [] } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )) as typeof fetch;
    await expect(
      new AnthropicProvider('test', 'test-model', 1000, fetcher).generate({
        prompt: 'biology',
        count: 2,
      }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
  });
  it('records actual usage and validates tool output', async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              name: 'emit_flashcards',
              input: { cards: [{ front: 'Q', back: 'A', hint: '', explanation: '', tags: [] }] },
            },
          ],
          usage: { input_tokens: 12, output_tokens: 30 },
        }),
        { status: 200 },
      )) as typeof fetch;
    const result = await new AnthropicProvider('test', 'test-model', 1000, fetcher).generate({
      prompt: 'biology',
      count: 1,
    });
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(30);
    expect(result.cards).toHaveLength(1);
  });
});
