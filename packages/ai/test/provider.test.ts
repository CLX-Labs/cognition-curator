import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/index.js';

function output(front: string) {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: 'tool_use',
          name: 'emit_flashcards',
          input: {
            cards: [
              {
                front,
                back: 'Converts mechanical energy into electrical energy.',
                hint: '',
                explanation: '',
                tags: [],
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 12, output_tokens: 30 },
    }),
    { status: 200 },
  );
}
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
              input: {
                cards: [{ front: 'Q', back: 'A', hint: '', explanation: '', tags: [] }],
              },
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

  it('requests short concept titles and keeps explanations in the answer', async () => {
    let body:
      | {
          system: string;
          tools: Array<{
            input_schema: {
              properties: {
                cards: {
                  items: { properties: { front: { description: string; maxLength: number } } };
                };
              };
            };
          }>;
        }
      | undefined;
    const fetcher = (async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return output('Alternator');
    }) as typeof fetch;
    const result = await new AnthropicProvider('test', 'test-model', 1000, fetcher).generate({
      prompt: 'Car electrical systems',
      count: 1,
    });
    expect(body!.system).toContain('usually 1–3 words');
    expect(body!.system).toContain('answer that exact question directly in back');
    expect(body!.tools[0]!.input_schema.properties.cards.items.properties.front).toMatchObject(
      { maxLength: 80, description: expect.stringContaining('Alternator') },
    );
    expect(result.cards[0]).toMatchObject({
      front: 'Alternator',
      back: 'Converts mechanical energy into electrical energy.',
    });
    expect(result.usage.promptVersion).toBe('flashcards-v2-concept-titles');
  });

  it.each([
    'What is an alternator?',
    'Describe how the alternator charges the car battery',
    'Alternator\nVoltage regulator',
    'a'.repeat(81),
  ])(
    'rejects verbose/question-form titles rather than silently truncating them (%s)',
    async (title) => {
      const fetcher = (async () => output(title)) as typeof fetch;
      await expect(
        new AnthropicProvider('test', 'test-model', 1000, fetcher).generate({
          prompt: 'Cars',
          count: 1,
        }),
      ).rejects.toMatchObject({ code: 'invalid_output', retryable: true });
    },
  );

  it.each(['TCP handshake', 'Pride and Prejudice', 'CAN bus', 'The Catcher in the Rye'])(
    'accepts succinct multiword concept names (%s)',
    async (title) => {
      const fetcher = (async () => output(title)) as typeof fetch;
      const result = await new AnthropicProvider('test', 'test-model', 1000, fetcher).generate(
        { prompt: 'Concepts', count: 1 },
      );
      expect(result.cards[0]!.front).toBe(title);
    },
  );
});
