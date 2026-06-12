import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { GenerateFlashcardsInput, GenerateAnswerInput } from '../schemas/ai.schema';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

function buildFlashcardPrompt(
  topic: string,
  count: number,
  difficulty: string,
  context?: string
): string {
  const difficultyGuidance: Record<string, string> = {
    easy: 'definitions and basic facts',
    medium: 'practical applications',
    hard: 'expert-level concepts',
  };

  return `Generate ${count} flashcards about "${topic}".
${context ? `Additional context: ${context}` : ''}

STRICT LENGTH RULES (MUST FOLLOW):
- Question: MAX 15 words, single line
- Answer: MAX 20 words, single line
- Explanation: MAX 15 words

CONTENT RULES:
- Difficulty: ${difficulty} (${difficultyGuidance[difficulty] ?? 'appropriate'})
- Test real knowledge, not trivia
- NO "What is X?" or "Define X" questions
- Answers must be direct facts, not explanations

Return ONLY valid JSON array:
[{"question":"...","answer":"...","explanation":"...","difficulty":"${difficulty}","tags":["tag1"],"confidence":0.9}]

Generate ${count} cards. Questions test expert knowledge. Answers are terse.`;
}

function parseFlashcardResponse(
  text: string,
  topic: string,
  difficulty: string
): Array<{
  question: string;
  answer: string;
  explanation: string;
  difficulty: string;
  tags: string[];
  confidence: number;
}> {
  try {
    let json = text.trim();
    if (json.includes('```json')) {
      const start = json.indexOf('```json') + 7;
      const end = json.indexOf('```', start);
      json = json.slice(start, end).trim();
    } else if (json.includes('[')) {
      const start = json.indexOf('[');
      const end = json.lastIndexOf(']') + 1;
      json = json.slice(start, end);
    }

    const parsed = JSON.parse(json) as Array<{
      question: string;
      answer: string;
      explanation?: string;
      difficulty?: string;
      tags?: string[];
      confidence?: number;
    }>;

    return parsed.map((card) => ({
      question: card.question ?? '',
      answer: card.answer ?? '',
      explanation: card.explanation ?? '',
      difficulty: card.difficulty ?? difficulty,
      tags: card.tags ?? [topic.toLowerCase(), 'ai-generated'],
      confidence: card.confidence ?? 0.85,
    }));
  } catch {
    return [
      {
        question: `Key concept in ${topic}?`,
        answer: `Fundamental ${topic} concept — study further.`,
        explanation: 'Fallback card — AI parsing failed.',
        difficulty,
        tags: [topic.toLowerCase(), 'fallback'],
        confidence: 0.3,
      },
    ];
  }
}

export const AiService = {
  isAvailable: () => anthropic !== null,

  generateFlashcards: async (data: GenerateFlashcardsInput) => {
    if (!anthropic) throw new Error('AI_UNAVAILABLE');

    const prompt = buildFlashcardPrompt(
      data.topic,
      data.number_of_cards,
      data.difficulty,
      data.additional_context
    );

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const cards = parseFlashcardResponse(text, data.topic, data.difficulty);

    return {
      flashcards: cards,
      metadata: {
        model: CLAUDE_MODEL,
        tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        topic: data.topic,
        difficulty: data.difficulty,
      },
    };
  },

  generateAnswer: async (data: GenerateAnswerInput) => {
    if (!anthropic) throw new Error('AI_UNAVAILABLE');

    const prompt = `Answer this flashcard question in MAX 20 words:

Q: ${data.question}
${data.context ? `Context: ${data.context}` : ''}

Rules:
- Direct answer only, no fluff
- MAX 20 words
- Don't repeat the question
- Don't say "The answer is..."
- Just state the fact`;

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const answer = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const topicLabel = data.deck_topic ?? 'general';

    return {
      answer,
      explanation: `Generated via Claude for ${topicLabel}`,
      confidence: 0.88,
      suggested_tags: [topicLabel.toLowerCase(), 'ai-generated'],
    };
  },
};
