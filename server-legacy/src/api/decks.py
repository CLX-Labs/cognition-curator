"""
Deck management API endpoints.
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models.deck import Deck

decks_bp = Blueprint("decks", __name__)


@decks_bp.route("/", methods=["GET"])
@jwt_required()
def get_decks():
    """Get all user decks."""
    try:
        current_user_id = get_jwt_identity()
        decks = Deck.query.filter_by(user_id=current_user_id, is_active=True).all()

        return jsonify({"decks": [deck.to_dict() for deck in decks]}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to get decks: {str(e)}"}), 500


@decks_bp.route("/", methods=["POST"])
@jwt_required()
def create_deck():
    """Create a new deck."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data or "name" not in data:
            return jsonify({"error": "Deck name required"}), 400

        deck = Deck(
            name=data["name"],
            user_id=current_user_id,
            description=data.get("description"),
            category=data.get("category"),
            color=data.get("color", "#007AFF"),
            icon=data.get("icon"),
        )

        db.session.add(deck)
        db.session.commit()

        return jsonify({"deck": deck.to_dict()}), 201

    except Exception as e:
        return jsonify({"error": f"Failed to create deck: {str(e)}"}), 500


@decks_bp.route("/<deck_id>", methods=["GET"])
@jwt_required()
def get_deck(deck_id):
    """Get a specific deck."""
    try:
        current_user_id = get_jwt_identity()

        deck = Deck.query.filter_by(
            id=deck_id, user_id=current_user_id, is_active=True
        ).first()
        if not deck:
            return jsonify({"error": "Deck not found or access denied"}), 404

        return jsonify({"deck": deck.to_dict()}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to get deck: {str(e)}"}), 500


@decks_bp.route("/<deck_id>", methods=["PUT"])
@jwt_required()
def update_deck(deck_id):
    """Update a deck."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data:
            return jsonify({"error": "No data provided"}), 400

        deck = Deck.query.filter_by(
            id=deck_id, user_id=current_user_id, is_active=True
        ).first()
        if not deck:
            return jsonify({"error": "Deck not found or access denied"}), 404

        # Update allowed fields
        updatable_fields = [
            "name",
            "description",
            "category",
            "color",
            "icon",
            "is_public",
        ]
        for field in updatable_fields:
            if field in data:
                setattr(deck, field, data[field])

        db.session.commit()

        return jsonify({"deck": deck.to_dict()}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to update deck: {str(e)}"}), 500


@decks_bp.route("/<deck_id>", methods=["DELETE"])
@jwt_required()
def delete_deck(deck_id):
    """Delete a deck."""
    try:
        current_user_id = get_jwt_identity()

        # Get deck and verify user owns it
        deck = Deck.query.filter_by(
            id=deck_id, user_id=current_user_id, is_active=True
        ).first()
        if not deck:
            return jsonify({"error": "Deck not found or access denied"}), 404

        # Soft delete by setting is_active to False
        # This preserves data for potential recovery and maintains referential integrity
        deck.is_active = False
        db.session.commit()

        return jsonify({"message": "Deck deleted successfully"}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to delete deck: {str(e)}"}), 500
