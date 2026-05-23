#!/usr/bin/env python3
"""
Test script for AI configuration
Run this to verify API keys and AI setup before deploying
"""

import asyncio
import os
import sys

from src.ai.manager import ai_manager
from src.ai.providers.base import AIGenerationRequest


async def test_ai_configuration():
    """Test AI provider configuration and generation"""
    print("🧪 Testing AI Configuration...")
    print("-" * 50)

    # Check environment variables
    print("📋 Checking Environment Variables:")
    ai_provider = os.getenv("AI_PROVIDER", "claude")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    fallback_enabled = os.getenv("AI_FALLBACK_ENABLED", "true")

    print(f"  AI_PROVIDER: {ai_provider}")
    print(f"  ANTHROPIC_API_KEY: {'✅ Set' if anthropic_key else '❌ Missing'}")
    print(f"  AI_FALLBACK_ENABLED: {fallback_enabled}")
    print()

    # Test provider initialization
    print("🔧 Testing Provider Initialization:")
    try:
        provider = ai_manager.get_provider()
        provider_info = provider.get_provider_info()
        print(f"  Provider: ✅ {provider_info['name']}")
        print(f"  Model: {provider_info.get('model', 'unknown')}")
        print(f"  Max Tokens: {provider_info.get('max_tokens', 'unknown')}")

        if provider_info["name"] == "Mock":
            print("  ⚠️  WARNING: Using fallback Mock provider!")
            print("  This means the API key is missing or invalid.")
            return False

    except Exception as e:
        print(f"  ❌ Provider initialization failed: {e}")
        return False

    print()

    # Test card generation
    print("🎯 Testing Card Generation:")
    try:
        test_request = AIGenerationRequest(
            topic="Python programming",
            number_of_cards=2,
            difficulty="medium",
            focus="basics",
            card_type="flashcard",
        )

        print("  Generating test cards...")
        response = await ai_manager.generate_flashcards(test_request)

        if response.cards:
            print(f"  ✅ Generated {len(response.cards)} cards")

            # Check if cards look real or are fallback
            first_card = response.cards[0]
            if "fallback" in first_card.tags or "mock" in first_card.tags:
                print("  ⚠️  WARNING: Generated fallback/mock cards!")
                print("  This indicates the AI service is not working properly.")
                return False
            else:
                print("  ✅ Cards appear to be real AI-generated content")
                print(f"  Sample: {first_card.question[:50]}...")

        else:
            print("  ❌ No cards generated")
            return False

    except Exception as e:
        print(f"  ❌ Card generation failed: {e}")
        return False

    print()
    print("🎉 AI Configuration Test Passed!")
    print("✅ Ready for production deployment")
    return True


def main():
    """Main test function"""
    # Add src to path for imports
    sys.path.insert(0, "src")

    success = asyncio.run(test_ai_configuration())

    if not success:
        print("\n❌ AI Configuration Test Failed!")
        print("Please fix the issues above before deploying to production.")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
