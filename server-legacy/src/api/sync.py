"""
Data synchronization API endpoints.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models.analytics import StudySession
from ..models.deck import Deck
from ..models.flashcard import Flashcard
from ..models.review_session import ReviewSession
from ..models.user import User

sync_bp = Blueprint("sync", __name__)


@sync_bp.route("/study-session", methods=["POST"])
@jwt_required()
def sync_study_session():
    """Sync a completed study session from iOS app."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Create study session record
        session = StudySession(
            user_id=current_user_id,
            deck_id=data.get("deck_id"),
            session_type=data.get("session_type", "regular"),
            started_at=datetime.fromisoformat(
                data["started_at"].replace("Z", "+00:00")
            ),
            ended_at=datetime.fromisoformat(data["ended_at"].replace("Z", "+00:00"))
            if data.get("ended_at")
            else None,
            duration_minutes=data.get("duration_minutes", 0),
            cards_reviewed=data.get("cards_reviewed", 0),
            cards_correct=data.get("cards_correct", 0),
            cards_incorrect=data.get("cards_incorrect", 0),
            accuracy_rate=data.get("accuracy_rate", 0.0),
            platform="iOS",
            device_type=data.get("device_type", "iPhone"),
            app_version=data.get("app_version"),
        )

        if session.ended_at:
            session.end_session()

        db.session.add(session)

        # Update user stats
        user = User.query.get(current_user_id)
        if user:
            user.update_study_stats(
                session_duration_minutes=session.duration_minutes,
                cards_reviewed=session.cards_reviewed,
                accuracy_rate=session.accuracy_rate,
            )

        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "session_id": str(session.id),
                    "message": "Study session synced successfully",
                }
            ),
            201,
        )

    except Exception as e:
        return jsonify({"error": f"Failed to sync study session: {str(e)}"}), 500


@sync_bp.route("/user-stats", methods=["POST"])
@jwt_required()
def sync_user_stats():
    """Sync user statistics from iOS app."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        user = User.query.get(current_user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Update user statistics
        if "current_streak_days" in data:
            user.current_streak_days = max(
                user.current_streak_days, data["current_streak_days"]
            )

        if "total_cards_reviewed" in data:
            user.total_cards_reviewed = max(
                user.total_cards_reviewed, data["total_cards_reviewed"]
            )

        if "total_study_time_minutes" in data:
            user.total_study_time_minutes = max(
                user.total_study_time_minutes, data["total_study_time_minutes"]
            )

        user.updated_at = datetime.now(timezone.utc)
        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "user": user.to_dict(),
                    "message": "User stats synced successfully",
                }
            ),
            200,
        )

    except Exception as e:
        return jsonify({"error": f"Failed to sync user stats: {str(e)}"}), 500


@sync_bp.route("/flashcard-review", methods=["POST"])
@jwt_required()
def sync_flashcard_review():
    """Sync an individual flashcard review from iOS app."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Required fields for individual review
        required_fields = [
            "flashcard_id",
            "difficulty_rating",
            "was_correct",
            "response_time_seconds",
        ]
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"{field} is required"}), 400

        # Verify flashcard belongs to user (through deck ownership)
        flashcard = (
            db.session.query(Flashcard)
            .join(Deck)
            .filter(
                Flashcard.id == data["flashcard_id"], Deck.user_id == current_user_id
            )
            .first()
        )

        if not flashcard:
            return jsonify({"error": "Flashcard not found or access denied"}), 404

        # Create review session record
        review = ReviewSession(
            user_id=current_user_id,
            deck_id=flashcard.deck_id,
            flashcard_id=data["flashcard_id"],
            difficulty_rating=data["difficulty_rating"],
            was_correct=data["was_correct"],
            response_time_seconds=data["response_time_seconds"],
            session_type=data.get("session_type", "regular"),
            platform="iOS",
            device_type=data.get("device_type", "iPhone"),
            app_version=data.get("app_version"),
            # Spaced repetition data
            ease_factor_before=data.get("ease_factor_before", 2.5),
            ease_factor_after=data.get("ease_factor_after", 2.5),
            interval_before_days=data.get("interval_before_days", 0),
            interval_after_days=data.get("interval_after_days", 1),
            repetitions_before=data.get("repetitions_before", 0),
            repetitions_after=data.get("repetitions_after", 1),
            confidence_level=data.get("confidence_level"),
            hint_used=data.get("hint_used", False),
            multiple_attempts=data.get("multiple_attempts", False),
        )

        db.session.add(review)

        # Update user stats incrementally
        user = User.query.get(current_user_id)
        if user:
            user.total_cards_reviewed += 1
            # Update accuracy incrementally
            if user.total_cards_reviewed > 1:
                # Weighted average update
                old_total = user.total_cards_reviewed - 1
                user.overall_accuracy_rate = (
                    user.overall_accuracy_rate * old_total
                    + (1.0 if data["was_correct"] else 0.0)
                ) / user.total_cards_reviewed
            else:
                user.overall_accuracy_rate = 1.0 if data["was_correct"] else 0.0

            user.updated_at = datetime.now(timezone.utc)

        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "review_id": str(review.id),
                    "message": "Flashcard review synced successfully",
                }
            ),
            201,
        )

    except Exception as e:
        return jsonify({"error": f"Failed to sync flashcard review: {str(e)}"}), 500
