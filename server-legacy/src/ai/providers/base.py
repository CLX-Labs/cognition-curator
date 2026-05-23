from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class FlashcardData:
    """Standard data structure for a flashcard"""
    question: str
    answer: str
    explanation: str
    difficulty: str
    tags: List[str]
    confidence: float


@dataclass
class AIGenerationRequest:
    """Request data for AI generation"""
    topic: str
    number_of_cards: int = 15
    difficulty: str = "medium"
    focus: Optional[str] = None
    card_type: str = "flashcard"


@dataclass
class AIResponse:
    """Response from AI provider"""
    cards: List[FlashcardData]
    metadata: Dict[str, Any]


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    def __init__(self, api_key: str, model: str = None):
        self.api_key = api_key
        self.model = model

    @abstractmethod
    async def generate_flashcards(self, request: AIGenerationRequest) -> AIResponse:
        """Generate flashcards for a given topic"""
        pass

    @abstractmethod
    async def generate_similar_card(self, base_card: FlashcardData, topic: str) -> FlashcardData:
        """Generate a similar card based on an existing card"""
        pass

    @abstractmethod
    async def generate_answer(self, question: str, context: str = "", deck_topic: str = "") -> Dict[str, Any]:
        """Generate an AI answer for a given question"""
        pass

    @abstractmethod
    def get_provider_info(self) -> Dict[str, str]:
        """Get information about this AI provider"""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name"""
        pass

    @property
    @abstractmethod
    def max_tokens(self) -> int:
        """Maximum tokens this provider supports"""
        pass