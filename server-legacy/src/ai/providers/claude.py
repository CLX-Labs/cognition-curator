import asyncio
import json
import logging
from typing import Any, Dict, List

from anthropic import Anthropic

from .base import AIGenerationRequest, AIProvider, AIResponse, FlashcardData

logger = logging.getLogger(__name__)


class ClaudeProvider(AIProvider):
    """Anthropic Claude AI provider for flashcard generation"""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        super().__init__(api_key, model)
        self.client = Anthropic(api_key=api_key)
        self._model = model

    @property
    def name(self) -> str:
        return "Claude"

    @property
    def max_tokens(self) -> int:
        return 2048  # Reduced to encourage concise responses

    def get_provider_info(self) -> Dict[str, str]:
        return {
            "name": self.name,
            "model": self._model,
            "provider": "Anthropic",
            "max_tokens": str(self.max_tokens),
        }

    async def generate_flashcards(self, request: AIGenerationRequest) -> AIResponse:
        """Generate flashcards using Claude"""

        prompt = self._build_flashcard_prompt(request)

        try:
            # Run the sync call in a thread pool to make it async
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.client.messages.create(
                    model=self._model,
                    max_tokens=self.max_tokens,
                    temperature=0.7,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )

            cards_data = self._parse_flashcard_response(
                response.content[0].text, request
            )

            metadata = {
                "model": self._model,
                "provider": self.name,
                "tokens_used": response.usage.input_tokens
                + response.usage.output_tokens,
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "generation_time": None,  # Claude doesn't provide this directly
                "prompt_length": len(prompt),
            }

            return AIResponse(cards=cards_data, metadata=metadata)

        except Exception as e:
            logger.error(f"Claude API error: {str(e)}")
            # Fallback to ensure we don't break the app
            return self._create_fallback_response(request)

    async def generate_similar_card(
        self, base_card: FlashcardData, topic: str
    ) -> FlashcardData:
        """Generate a similar card based on an existing card"""

        prompt = f"""Generate ONE flashcard similar to this:
Q: {base_card.question}
A: {base_card.answer}
Topic: {topic}

STRICT RULES:
- Question: MAX 15 words
- Answer: MAX 20 words
- Different concept, same topic
- NO generic questions

Return ONLY JSON:
{{"question":"...","answer":"...","explanation":"...","confidence":0.85}}"""

        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.client.messages.create(
                    model=self._model,
                    max_tokens=300,  # Reduced for concise output
                    temperature=0.7,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )

            response_text = response.content[0].text.strip()

            # Extract JSON from response
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "{" in response_text:
                # Find the JSON object
                start = response_text.find("{")
                end = response_text.rfind("}") + 1
                response_text = response_text[start:end]

            card_data = json.loads(response_text)

            return FlashcardData(
                question=card_data["question"],
                answer=card_data["answer"],
                explanation=card_data["explanation"],
                difficulty=base_card.difficulty,
                tags=base_card.tags + ["ai-similar"],
                confidence=card_data.get("confidence", 0.85),
            )

        except Exception as e:
            logger.error(f"Error generating similar card: {str(e)}")
            # Return a basic similar card as fallback
            return FlashcardData(
                question=f"Related to {topic}: Another key aspect?",
                answer=f"A related concept in {topic}.",
                explanation="Fallback card - AI generation failed.",
                difficulty=base_card.difficulty,
                tags=base_card.tags + ["fallback"],
                confidence=0.6,
            )

    async def generate_answer(
        self, question: str, context: str = "", deck_topic: str = ""
    ) -> Dict[str, Any]:
        """Generate an AI answer for a given question"""

        logger.info(f"Generating answer for: {question[:50]}...")

        prompt = f"""Answer this flashcard question in MAX 20 words:

Q: {question}
{f"Context: {context}" if context else ""}

Rules:
- Direct answer only, no fluff
- MAX 20 words
- Don't repeat the question
- Don't say "The answer is..."
- Just state the fact"""

        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.client.messages.create(
                    model=self._model,
                    max_tokens=200,  # Reduced for concise answers
                    temperature=0.5,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )

            answer = response.content[0].text.strip()
            logger.info(f"Generated answer: {answer[:100]}...")

            topic_label = deck_topic or "general"
            return {
                "answer": answer,
                "explanation": f"Generated via {self.name} for {topic_label}",
                "confidence": 0.88,
                "sources": [],
                "suggested_tags": [
                    deck_topic.lower() if deck_topic else "general",
                    "ai-generated",
                ],
            }

        except Exception as e:
            logger.error(f"Error generating answer: {str(e)}")
            return {
                "answer": "Unable to generate answer due to technical issue.",
                "explanation": "Fallback response - AI generation failed.",
                "confidence": 0.1,
                "sources": [],
                "suggested_tags": ["error", "fallback"],
            }

    def _build_flashcard_prompt(self, request: AIGenerationRequest) -> str:
        """Build optimized prompt for flashcard generation."""

        difficulty_guidance = {
            "easy": "definitions and basic facts",
            "medium": "practical applications",
            "hard": "expert-level concepts",
        }

        diff = request.difficulty
        diff_desc = difficulty_guidance.get(diff, "appropriate")
        n = request.number_of_cards
        topic = request.topic

        base_prompt = f"""Generate {n} flashcards about "{topic}".

STRICT LENGTH RULES (MUST FOLLOW):
- Question: MAX 15 words, single line
- Answer: MAX 20 words, single line
- Explanation: MAX 15 words

CONTENT RULES:
- Difficulty: {diff} ({diff_desc})
- Test real knowledge, not trivia
- NO "What is X?" or "Define X" questions
- Answers must be direct facts, not explanations

BAD EXAMPLES (too long):
❌ Q: "What approach for state management in large React apps?"
❌ A: "Redux or Context API depending on complexity."

GOOD EXAMPLES (concise):
✓ Q: "Default React hook for local component state?"
✓ A: "useState"

✓ Q: "Python list method to add item at end?"
✓ A: "append()"

✓ Q: "SQL keyword to remove duplicates?"
✓ A: "DISTINCT"

Return ONLY valid JSON array:
[{{"question":"...","answer":"...","explanation":"...","difficulty":"{diff}","tags":["tag1"],"confidence":0.9}}]

Generate {n} cards. Questions test expert knowledge. Answers are terse."""

        return base_prompt

    def _parse_flashcard_response(
        self, response_text: str, request: AIGenerationRequest
    ) -> List[FlashcardData]:
        """Parse Claude's response into FlashcardData objects"""

        try:
            # Clean up the response text
            response_text = response_text.strip()

            # Extract JSON array from response
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "[" in response_text and "]" in response_text:
                # Find the JSON array
                start = response_text.find("[")
                end = response_text.rfind("]") + 1
                response_text = response_text[start:end]

            cards_json = json.loads(response_text)

            cards = []
            default_tags = [request.topic.lower(), "ai-generated"]
            for card_data in cards_json:
                card = FlashcardData(
                    question=card_data.get("question", ""),
                    answer=card_data.get("answer", ""),
                    explanation=card_data.get("explanation", ""),
                    difficulty=card_data.get("difficulty", request.difficulty),
                    tags=card_data.get("tags", default_tags),
                    confidence=card_data.get("confidence", 0.85),
                )
                cards.append(card)

            return cards

        except Exception as e:
            logger.error(f"Error parsing Claude response: {str(e)}")
            logger.debug(f"Raw response: {response_text}")
            return self._create_fallback_cards(request)

    def _create_fallback_response(self, request: AIGenerationRequest) -> AIResponse:
        """Create fallback response when AI fails"""
        cards = self._create_fallback_cards(request)
        metadata = {
            "model": "fallback",
            "provider": "fallback",
            "tokens_used": 0,
            "error": "AI generation failed, using fallback",
        }
        return AIResponse(cards=cards, metadata=metadata)

    def _create_fallback_cards(
        self, request: AIGenerationRequest
    ) -> List[FlashcardData]:
        """Create basic fallback cards when AI fails"""
        topic = request.topic
        return [
            FlashcardData(
                question=f"Key concept in {topic}?",
                answer=f"Fundamental {topic} concept - study further.",
                explanation="Fallback card - AI generation failed.",
                difficulty=request.difficulty,
                tags=[topic.lower(), "fallback"],
                confidence=0.3,
            )
            for _ in range(min(request.number_of_cards, 3))
        ]
