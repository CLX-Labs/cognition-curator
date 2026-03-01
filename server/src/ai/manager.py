import logging
import os
from enum import Enum
from typing import Any, Dict, Optional

from .providers.base import AIGenerationRequest, AIProvider, AIResponse, FlashcardData
from .providers.claude import ClaudeProvider

logger = logging.getLogger(__name__)


class AIProviderType(Enum):
    """Supported AI providers"""

    CLAUDE = "claude"
    OPENAI = "openai"  # For future implementation
    OLLAMA = "ollama"  # For future local model support


class AIManager:
    """Manages AI providers and handles switching between them"""

    def __init__(self):
        self._provider: Optional[AIProvider] = None
        self._provider_type: Optional[AIProviderType] = None
        self._config = self._load_config()

    def _load_config(self) -> Dict[str, Any]:
        """Load AI configuration from environment variables"""
        return {
            "provider": os.getenv("AI_PROVIDER", "claude").lower(),
            "claude_api_key": os.getenv("ANTHROPIC_API_KEY"),
            "claude_model": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
            "openai_api_key": os.getenv("OPENAI_API_KEY"),
            "openai_model": os.getenv("OPENAI_MODEL", "gpt-4"),
            "fallback_enabled": os.getenv("AI_FALLBACK_ENABLED", "true").lower()
            == "true",
        }

    def get_provider(self) -> AIProvider:
        """Get the current AI provider, initializing if necessary"""
        if self._provider is None:
            self._initialize_provider()
        return self._provider

    def _initialize_provider(self):
        """Initialize the AI provider based on configuration"""
        provider_name = self._config["provider"]

        try:
            if provider_name == "claude":
                self._provider = self._create_claude_provider()
                self._provider_type = AIProviderType.CLAUDE
                logger.info("Initialized Claude AI provider")

            elif provider_name == "openai":
                # Future implementation
                raise NotImplementedError("OpenAI provider not yet implemented")

            elif provider_name == "ollama":
                # Future implementation
                raise NotImplementedError("Ollama provider not yet implemented")

            else:
                raise ValueError(f"Unknown AI provider: {provider_name}")

        except Exception as e:
            logger.error(
                f"Failed to initialize AI provider '{provider_name}': {str(e)}"
            )

            if self._config["fallback_enabled"]:
                logger.info("Falling back to mock provider")
                self._provider = self._create_fallback_provider()
                self._provider_type = None
            else:
                raise

    def _create_claude_provider(self) -> ClaudeProvider:
        """Create Claude provider instance"""
        api_key = self._config["claude_api_key"]
        if not api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY environment variable is required for Claude provider"
            )

        model = self._config["claude_model"]
        return ClaudeProvider(api_key=api_key, model=model)

    def _create_fallback_provider(self) -> AIProvider:
        """Create a fallback mock provider when real AI fails"""
        from .providers.mock import (  # Import here to avoid circular dependency
            MockProvider,
        )

        return MockProvider()

    def switch_provider(self, provider_type: AIProviderType, **kwargs):
        """Switch to a different AI provider"""
        try:
            if provider_type == AIProviderType.CLAUDE:
                api_key = kwargs.get("api_key") or self._config["claude_api_key"]
                model = kwargs.get("model") or self._config["claude_model"]

                if not api_key:
                    raise ValueError("API key required for Claude provider")

                self._provider = ClaudeProvider(api_key=api_key, model=model)

            elif provider_type == AIProviderType.OPENAI:
                raise NotImplementedError("OpenAI provider not yet implemented")

            elif provider_type == AIProviderType.OLLAMA:
                raise NotImplementedError("Ollama provider not yet implemented")

            else:
                raise ValueError(f"Unknown provider type: {provider_type}")

            self._provider_type = provider_type
            logger.info(f"Switched to {provider_type.value} provider")

        except Exception as e:
            logger.error(
                f"Failed to switch to {provider_type.value} provider: {str(e)}"
            )
            raise

    def get_provider_info(self) -> Dict[str, Any]:
        """Get information about the current provider"""
        if self._provider is None:
            return {"status": "not_initialized"}

        info = self._provider.get_provider_info()
        info["status"] = "active"
        info["provider_type"] = (
            self._provider_type.value if self._provider_type else "fallback"
        )
        return info

    def is_available(self) -> bool:
        """Check if AI provider is available and working"""
        try:
            provider = self.get_provider()
            return provider is not None
        except Exception:
            return False

    async def generate_flashcards(self, request: AIGenerationRequest) -> AIResponse:
        """Generate flashcards using the current provider"""
        provider = self.get_provider()
        return await provider.generate_flashcards(request)

    async def generate_similar_card(
        self, base_card: FlashcardData, topic: str
    ) -> FlashcardData:
        """Generate a similar card using the current provider"""
        provider = self.get_provider()
        return await provider.generate_similar_card(base_card, topic)

    async def generate_answer(
        self, question: str, context: str = "", deck_topic: str = ""
    ) -> Dict[str, Any]:
        """Generate an answer using the current provider"""
        provider = self.get_provider()
        return await provider.generate_answer(question, context, deck_topic)


# Global AI manager instance
ai_manager = AIManager()
