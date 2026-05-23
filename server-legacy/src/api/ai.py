import asyncio
import logging
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from ..ai.manager import ai_manager
from ..ai.providers.base import AIGenerationRequest, FlashcardData

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__)


@ai_bp.route("/status", methods=["GET"])
async def ai_status():
    """Check AI provider status and configuration"""
    try:
        provider = ai_manager.get_provider()
        provider_info = provider.get_provider_info()

        return (
            jsonify(
                {
                    "status": "ok",
                    "provider": provider_info,
                    "message": "AI service is configured and ready",
                }
            ),
            200,
        )

    except Exception as e:
        logger.error(f"AI status check failed: {str(e)}")
        return (
            jsonify(
                {
                    "status": "error",
                    "error": str(e),
                    "message": "AI service is not properly configured",
                }
            ),
            500,
        )


@ai_bp.route("/generate-flashcards", methods=["POST"])
async def generate_flashcards():
    """Generate flashcards using real AI"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        topic = data.get("topic", "").strip()
        if not topic:
            return jsonify({"error": "Topic is required"}), 400

        number_of_cards = data.get("number_of_cards", 15)
        difficulty = data.get("difficulty", "medium")
        focus = data.get("focus")
        card_type = data.get("card_type", "flashcard")

        # Validate inputs
        if number_of_cards < 1 or number_of_cards > 50:
            return jsonify({"error": "Number of cards must be between 1 and 50"}), 400

        if difficulty not in ["easy", "medium", "hard"]:
            return jsonify({"error": "Difficulty must be easy, medium, or hard"}), 400

        # Create AI request
        ai_request = AIGenerationRequest(
            topic=topic,
            number_of_cards=number_of_cards,
            difficulty=difficulty,
            focus=focus,
            card_type=card_type,
        )

        # Generate cards using real AI
        logger.info(
            f"Generating {number_of_cards} {difficulty} flashcards for topic: {topic}"
        )
        ai_response = await ai_manager.generate_flashcards(ai_request)

        # Convert to API response format
        cards = []
        for card in ai_response.cards:
            cards.append(
                {
                    "question": card.question,
                    "answer": card.answer,
                    "explanation": card.explanation,
                    "difficulty": card.difficulty,
                    "tags": card.tags,
                    "confidence": card.confidence,
                }
            )

        # Calculate average confidence
        confidence_avg = (
            sum(card.confidence for card in ai_response.cards) / len(ai_response.cards)
            if ai_response.cards
            else 0.0
        )

        response = {
            "cards": cards,
            "topic": topic,
            "total_generated": len(cards),
            "difficulty": difficulty,
            "focus": focus,
            "generation_time": 2.5,  # Placeholder since Claude doesn't provide this directly
            "model_version": ai_response.metadata.get("model", "unknown"),
            "confidence_avg": confidence_avg,
        }

        logger.info(
            f"Successfully generated {len(cards)} cards using {ai_response.metadata.get('provider', 'unknown')} provider"
        )
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"AI flashcard generation failed: {str(e)}")
        return jsonify({"error": f"Generation failed: {str(e)}"}), 500


@ai_bp.route("/generate-similar", methods=["POST"])
async def generate_similar_cards():
    """Generate similar cards using real AI"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        base_card_data = data.get("card", {})
        topic = data.get("topic", "")
        count = data.get("count", 1)

        if not base_card_data:
            return jsonify({"error": "Base card is required"}), 400

        # Convert to FlashcardData object
        base_card = FlashcardData(
            question=base_card_data.get("question", ""),
            answer=base_card_data.get("answer", ""),
            explanation=base_card_data.get("explanation", ""),
            difficulty=base_card_data.get("difficulty", "medium"),
            tags=base_card_data.get("tags", []),
            confidence=base_card_data.get("confidence", 0.8),
        )

        # Generate similar cards (currently only 1 at a time for better quality)
        logger.info(f"Generating similar card for topic: {topic}")
        similar_card = await ai_manager.generate_similar_card(base_card, topic)

        # Convert to API response format
        similar_cards = [
            {
                "question": similar_card.question,
                "answer": similar_card.answer,
                "explanation": similar_card.explanation,
                "difficulty": similar_card.difficulty,
                "tags": similar_card.tags,
                "confidence": similar_card.confidence,
            }
        ]

        response = {
            "similar_cards": similar_cards,
            "provider_info": ai_manager.get_provider_info(),
        }

        logger.info(
            f"Successfully generated similar card using {ai_manager.get_provider_info().get('provider', 'unknown')} provider"
        )
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Similar card generation failed: {str(e)}")
        return jsonify({"error": f"Similar card generation failed: {str(e)}"}), 500


@ai_bp.route("/generate-answer", methods=["POST"])
async def generate_answer():
    """Generate an AI answer for a given question"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        question = data.get("question", "").strip()
        if not question:
            return jsonify({"error": "Question is required"}), 400

        context = data.get("context", "").strip()
        difficulty = data.get("difficulty", "medium")
        deck_topic = data.get("deck_topic", "").strip()

        # Validate inputs
        if difficulty not in ["easy", "medium", "hard"]:
            return jsonify({"error": "Difficulty must be easy, medium, or hard"}), 400

        # Generate answer using real AI
        logger.info(
            f"Generating answer for question about {deck_topic or 'general topic'}"
        )
        answer_data = await ai_manager.generate_answer(question, context, deck_topic)

        # Get provider info for metadata
        provider_info = ai_manager.get_provider_info()

        response = {
            "answer": answer_data["answer"],
            "explanation": answer_data.get("explanation"),
            "confidence": answer_data.get("confidence", 0.85),
            "sources": answer_data.get("sources", []),
            "difficulty": difficulty,
            "generation_time": 2.0,  # Placeholder since Claude doesn't provide this
            "model_version": provider_info.get("model", "unknown"),
            "suggested_tags": answer_data.get("suggested_tags", []),
        }

        logger.info(
            f"Successfully generated answer using {ai_manager.get_provider_info().get('provider', 'unknown')} provider"
        )
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Answer generation failed: {str(e)}")
        return jsonify({"error": f"Answer generation failed: {str(e)}"}), 500


@ai_bp.route("/enhance-card", methods=["POST"])
async def enhance_card():
    """Enhance an existing flashcard using AI"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        original_card = data.get("card", {})
        context = data.get("context", "")

        if not original_card:
            return jsonify({"error": "Card is required"}), 400

        # For now, use the answer generation to enhance the explanation
        question = original_card.get("question", "")
        topic = context or "general"

        if question:
            enhancement_data = await ai_manager.generate_answer(
                f"Provide a detailed explanation for this flashcard question: {question}",
                context=f"This is for a flashcard about {topic}",
                deck_topic=topic,
            )

            enhanced_card = original_card.copy()
            enhanced_card["explanation"] = enhancement_data["answer"]
            enhanced_card["confidence"] = min(
                0.98, enhanced_card.get("confidence", 0.8) + 0.1
            )
        else:
            enhanced_card = original_card

        response = {
            "enhanced_card": enhanced_card,
            "provider_info": ai_manager.get_provider_info(),
        }

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Card enhancement failed: {str(e)}")
        return jsonify({"error": f"Enhancement failed: {str(e)}"}), 500


@ai_bp.route("/provider/info", methods=["GET"])
def get_provider_info():
    """Get information about the current AI provider"""
    try:
        info = ai_manager.get_provider_info()
        info["available"] = ai_manager.is_available()
        return jsonify(info), 200
    except Exception as e:
        logger.error(f"Failed to get provider info: {str(e)}")
        return jsonify({"error": "Failed to get provider information"}), 500


@ai_bp.route("/provider/switch", methods=["POST"])
def switch_provider():
    """Switch AI provider (for admin use)"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        provider_type = data.get("provider")
        if not provider_type:
            return jsonify({"error": "Provider type is required"}), 400

        # This would be admin-only functionality
        # For now, return not implemented
        return jsonify({"error": "Provider switching not yet implemented"}), 501

    except Exception as e:
        logger.error(f"Provider switch failed: {str(e)}")
        return jsonify({"error": f"Provider switch failed: {str(e)}"}), 500


@ai_bp.route("/topics/suggestions", methods=["GET"])
def get_topic_suggestions():
    """Get topic suggestions for AI generation"""
    suggestions = {
        "popular": [
            "TypeScript",
            "React Hooks",
            "Python Programming",
            "Cooking Fundamentals",
            "Chess Strategy",
            "Spanish Verbs",
            "Cell Biology",
            "World War II",
            "Calculus Derivatives",
            "Photography Basics",
        ],
        "categories": {
            "Programming": [
                "JavaScript ES6",
                "TypeScript",
                "React Hooks",
                "Python Programming",
                "SQL Queries",
                "Git & Version Control",
                "API Design",
                "Data Structures",
            ],
            "Culinary Arts": [
                "Cooking Fundamentals",
                "Baking Techniques",
                "Food Safety",
                "Knife Skills",
                "French Cuisine",
                "Pastry Making",
            ],
            "Strategy & Games": [
                "Chess Strategy",
                "Chess Tactics",
                "Poker Strategy",
                "Go (Weiqi)",
                "Strategic Thinking",
            ],
            "Language Learning": [
                "Spanish Verbs",
                "French Vocabulary",
                "German Grammar",
                "Japanese Hiragana",
                "Italian Pronunciation",
            ],
            "Science": [
                "Cell Biology",
                "Chemistry Bonds",
                "Physics Mechanics",
                "Organic Chemistry",
                "Astronomy",
                "Genetics",
            ],
            "History": [
                "World War II",
                "Ancient Rome",
                "American Revolution",
                "Medieval Europe",
                "Cold War",
            ],
            "Mathematics": [
                "Calculus Derivatives",
                "Linear Algebra",
                "Statistics",
                "Geometry Theorems",
                "Number Theory",
            ],
            "Arts & Creative": [
                "Photography Basics",
                "Art History",
                "Music Theory",
                "Drawing Techniques",
                "Color Theory",
            ],
        },
    }

    return jsonify(suggestions), 200


# Helper function to make the blueprint async-compatible
def make_async_endpoint(f):
    """Convert async function to work with Flask"""

    def wrapper(*args, **kwargs):
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(f(*args, **kwargs))
        finally:
            loop.close()

    return wrapper


# Apply async wrapper to async endpoints
ai_bp.view_functions["generate_flashcards"] = make_async_endpoint(generate_flashcards)
ai_bp.view_functions["generate_similar_cards"] = make_async_endpoint(
    generate_similar_cards
)
ai_bp.view_functions["generate_answer"] = make_async_endpoint(generate_answer)
ai_bp.view_functions["enhance_card"] = make_async_endpoint(enhance_card)
