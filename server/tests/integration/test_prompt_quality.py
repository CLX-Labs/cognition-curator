"""
Tests for AI prompt quality and output length constraints.

These tests verify that the AI generates concise flashcards that meet
the strict length requirements for effective spaced repetition learning.

Run with: pytest tests/integration/test_prompt_quality.py -v
"""

import os
import statistics
import time
from typing import Dict, List

import pytest
import requests

# Configuration
BASE_URL = os.getenv("TEST_API_URL", "http://127.0.0.1:5001")
SIMULATOR_TOKEN = "simulator-test-token-1705739520"

# Length constraints (words)
MAX_QUESTION_WORDS = 15
MAX_ANSWER_WORDS = 20
MAX_EXPLANATION_WORDS = 15

# Length constraints (characters)
MAX_QUESTION_CHARS = 100
MAX_ANSWER_CHARS = 150


def get_auth_token():
    """Get authentication token from the server."""
    response = requests.post(
        f"{BASE_URL}/api/auth/apple-signin",
        json={"identity_token": SIMULATOR_TOKEN},
    )
    if response.status_code in [200, 201]:
        return response.json().get("access_token")
    return None


def generate_flashcards(
    token: str,
    topic: str,
    num_cards: int = 5,
    difficulty: str = "medium",
) -> List[Dict]:
    """Generate flashcards and return the cards list."""
    response = requests.post(
        f"{BASE_URL}/api/ai/generate-flashcards",
        json={
            "topic": topic,
            "number_of_cards": num_cards,
            "difficulty": difficulty,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    if response.status_code == 200:
        return response.json().get("cards", [])
    return []


def count_words(text: str) -> int:
    """Count words in text."""
    return len(text.split()) if text else 0


def analyze_card_lengths(cards: List[Dict]) -> Dict:
    """Analyze length statistics for a set of cards."""
    q_words = [count_words(c.get("question", "")) for c in cards]
    a_words = [count_words(c.get("answer", "")) for c in cards]
    q_chars = [len(c.get("question", "")) for c in cards]
    a_chars = [len(c.get("answer", "")) for c in cards]

    return {
        "question_words": {
            "min": min(q_words) if q_words else 0,
            "max": max(q_words) if q_words else 0,
            "avg": statistics.mean(q_words) if q_words else 0,
            "values": q_words,
        },
        "answer_words": {
            "min": min(a_words) if a_words else 0,
            "max": max(a_words) if a_words else 0,
            "avg": statistics.mean(a_words) if a_words else 0,
            "values": a_words,
        },
        "question_chars": {
            "min": min(q_chars) if q_chars else 0,
            "max": max(q_chars) if q_chars else 0,
            "avg": statistics.mean(q_chars) if q_chars else 0,
        },
        "answer_chars": {
            "min": min(a_chars) if a_chars else 0,
            "max": max(a_chars) if a_chars else 0,
            "avg": statistics.mean(a_chars) if a_chars else 0,
        },
    }


class TestPromptLength:
    """Test that generated content meets length constraints."""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"
        return token

    @pytest.mark.slow
    @pytest.mark.ai
    def test_question_word_count(self, auth_token):
        """Test that questions are within word limit."""
        cards = generate_flashcards(auth_token, "JavaScript fundamentals", 5)

        assert len(cards) > 0, "No cards generated"

        for i, card in enumerate(cards):
            question = card.get("question", "")
            word_count = count_words(question)

            assert word_count <= MAX_QUESTION_WORDS, (
                f"Card {i+1} question too long: "
                f"{word_count} words > {MAX_QUESTION_WORDS}\n"
                f"Question: {question}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_answer_word_count(self, auth_token):
        """Test that answers are within word limit."""
        cards = generate_flashcards(auth_token, "SQL basics", 5)

        assert len(cards) > 0, "No cards generated"

        for i, card in enumerate(cards):
            answer = card.get("answer", "")
            word_count = count_words(answer)

            assert word_count <= MAX_ANSWER_WORDS, (
                f"Card {i+1} answer too long: "
                f"{word_count} words > {MAX_ANSWER_WORDS}\n"
                f"Answer: {answer}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_question_character_count(self, auth_token):
        """Test that questions are within character limit."""
        cards = generate_flashcards(auth_token, "Git commands", 5)

        assert len(cards) > 0, "No cards generated"

        for i, card in enumerate(cards):
            question = card.get("question", "")
            char_count = len(question)

            assert char_count <= MAX_QUESTION_CHARS, (
                f"Card {i+1} question too long: "
                f"{char_count} chars > {MAX_QUESTION_CHARS}\n"
                f"Question: {question}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_answer_character_count(self, auth_token):
        """Test that answers are within character limit."""
        cards = generate_flashcards(auth_token, "Docker basics", 5)

        assert len(cards) > 0, "No cards generated"

        for i, card in enumerate(cards):
            answer = card.get("answer", "")
            char_count = len(answer)

            assert char_count <= MAX_ANSWER_CHARS, (
                f"Card {i+1} answer too long: "
                f"{char_count} chars > {MAX_ANSWER_CHARS}\n"
                f"Answer: {answer}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_average_lengths_reasonable(self, auth_token):
        """Test that average lengths are reasonable (not just under max)."""
        cards = generate_flashcards(auth_token, "React hooks", 10)

        assert len(cards) >= 5, "Not enough cards generated"

        stats = analyze_card_lengths(cards)

        # Average question should be well under the max (aim for ~10 words avg)
        avg_q = stats["question_words"]["avg"]
        assert avg_q <= 12, f"Average question too verbose: {avg_q:.1f} words"

        # Average answer should be very short (aim for ~5 words avg)
        avg_a = stats["answer_words"]["avg"]
        assert avg_a <= 10, f"Average answer too verbose: {avg_a:.1f} words"


class TestPromptQuality:
    """Test that generated content is high quality."""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"
        return token

    @pytest.mark.slow
    @pytest.mark.ai
    def test_no_generic_questions(self, auth_token):
        """Test that questions are not generic 'What is X?' format."""
        cards = generate_flashcards(auth_token, "Python programming", 5)

        assert len(cards) > 0, "No cards generated"

        generic_patterns = [
            "what is ",
            "what are ",
            "define ",
            "explain ",
            "describe ",
            "what does",
        ]

        for i, card in enumerate(cards):
            question = card.get("question", "").lower()

            for pattern in generic_patterns:
                assert not question.startswith(pattern), (
                    f"Card {i+1} has generic question "
                    f"starting with '{pattern}':\n"
                    f"Question: {card.get('question', '')}"
                )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_answers_are_not_explanations(self, auth_token):
        """Test that answers are direct, not explanatory."""
        cards = generate_flashcards(auth_token, "CSS selectors", 5)

        assert len(cards) > 0, "No cards generated"

        explanatory_patterns = [
            "this is ",
            "it is ",
            "the answer is ",
            "you can ",
            "you should ",
            "this allows ",
        ]

        for i, card in enumerate(cards):
            answer = card.get("answer", "").lower()

            for pattern in explanatory_patterns:
                assert not answer.startswith(pattern), (
                    f"Card {i+1} answer is explanatory, not direct:\n"
                    f"Answer: {card.get('answer', '')}"
                )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_questions_are_testable(self, auth_token):
        """Test that questions end with question mark."""
        cards = generate_flashcards(auth_token, "HTTP methods", 5)

        assert len(cards) > 0, "No cards generated"

        for i, card in enumerate(cards):
            question = card.get("question", "").strip()

            assert question.endswith("?"), (
                f"Card {i+1} question doesn't end with '?':\n" f"Question: {question}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_no_duplicate_questions(self, auth_token):
        """Test that generated cards don't have duplicate questions."""
        cards = generate_flashcards(auth_token, "Linux commands", 10)

        assert len(cards) >= 5, "Not enough cards generated"

        questions = [c.get("question", "").lower().strip() for c in cards]
        unique_questions = set(questions)

        num_dupes = len(questions) - len(unique_questions)
        assert len(unique_questions) == len(
            questions
        ), f"Found duplicate questions: {num_dupes} duplicates"


class TestDifficultyLevels:
    """Test that difficulty levels affect output appropriately."""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"
        return token

    @pytest.mark.slow
    @pytest.mark.ai
    def test_easy_cards_are_basic(self, auth_token):
        """Test that easy cards cover basic concepts."""
        cards = generate_flashcards(auth_token, "Python", 3, difficulty="easy")

        assert len(cards) > 0, "No cards generated"

        # Easy cards should have short, simple answers
        for card in cards:
            answer = card.get("answer", "")
            word_count = count_words(answer)

            assert word_count <= 10, (
                f"Easy card answer too complex: {word_count} words\n"
                f"Answer: {answer}"
            )

    @pytest.mark.slow
    @pytest.mark.ai
    def test_hard_cards_are_specific(self, auth_token):
        """Test that hard cards test specific knowledge."""
        cards = generate_flashcards(auth_token, "Python", 3, difficulty="hard")

        assert len(cards) > 0, "No cards generated"

        # Hard cards should still be concise but test deeper knowledge
        for card in cards:
            question = card.get("question", "")

            # Should not be overly generic
            assert len(question) >= 20, f"Hard card question too simple: {question}"


class TestPerformance:
    """Test generation performance."""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"
        return token

    @pytest.mark.slow
    @pytest.mark.ai
    def test_generation_time_3_cards(self, auth_token):
        """Test that generating 3 cards takes reasonable time."""
        start = time.time()
        cards = generate_flashcards(auth_token, "JavaScript", 3, "easy")
        elapsed = time.time() - start

        assert len(cards) == 3, f"Expected 3 cards, got {len(cards)}"
        assert elapsed < 15, f"Generation took too long: {elapsed:.1f}s > 15s"

        print(f"\n3 cards generated in {elapsed:.1f}s")

    @pytest.mark.slow
    @pytest.mark.ai
    def test_generation_time_10_cards(self, auth_token):
        """Test that generating 10 cards takes reasonable time."""
        start = time.time()
        cards = generate_flashcards(auth_token, "React", 10, "medium")
        elapsed = time.time() - start

        assert len(cards) >= 8, f"Expected ~10 cards, got {len(cards)}"
        assert elapsed < 30, f"Generation took too long: {elapsed:.1f}s > 30s"

        print(f"\n10 cards generated in {elapsed:.1f}s")


# Summary report test
class TestPromptSummary:
    """Generate a summary report of prompt quality."""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"
        return token

    @pytest.mark.slow
    @pytest.mark.ai
    def test_generate_quality_report(self, auth_token):
        """Generate a quality report for the prompt output."""
        topics = ["Python basics", "JavaScript", "SQL", "Git", "Docker"]
        all_cards = []

        for topic in topics:
            cards = generate_flashcards(auth_token, topic, 3, "medium")
            all_cards.extend(cards)

        stats = analyze_card_lengths(all_cards)

        print("\n" + "=" * 60)
        print("PROMPT QUALITY REPORT")
        print("=" * 60)
        print(f"Total cards analyzed: {len(all_cards)}")
        print()
        print("Question Length (words):")
        print(f"  Min: {stats['question_words']['min']}")
        print(f"  Max: {stats['question_words']['max']}")
        print(f"  Avg: {stats['question_words']['avg']:.1f}")
        print()
        print("Answer Length (words):")
        print(f"  Min: {stats['answer_words']['min']}")
        print(f"  Max: {stats['answer_words']['max']}")
        print(f"  Avg: {stats['answer_words']['avg']:.1f}")
        print()
        print("Question Length (chars):")
        print(f"  Min: {stats['question_chars']['min']}")
        print(f"  Max: {stats['question_chars']['max']}")
        print(f"  Avg: {stats['question_chars']['avg']:.1f}")
        print()
        print("Answer Length (chars):")
        print(f"  Min: {stats['answer_chars']['min']}")
        print(f"  Max: {stats['answer_chars']['max']}")
        print(f"  Avg: {stats['answer_chars']['avg']:.1f}")
        print("=" * 60)

        # Assert quality thresholds
        avg_q = stats["question_words"]["avg"]
        avg_a = stats["answer_words"]["avg"]
        assert avg_q <= 12, "Average question too verbose"
        assert avg_a <= 10, "Average answer too verbose"
