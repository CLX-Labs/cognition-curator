"""
Authentication API endpoints with Apple Sign In support.
"""

from datetime import datetime, timezone

import jwt as jwt_lib
import requests
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from ..database import db
from ..models.user import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/apple-signin", methods=["POST"])
def apple_signin():
    """
    Handle Apple Sign In authentication.
    Expects an Apple ID token from the iOS app.
    """
    try:
        data = request.get_json()

        if not data or "identity_token" not in data:
            return jsonify({"error": "Apple identity token required"}), 400

        identity_token = data["identity_token"]
        user_info = data.get("user", {})  # Only available on first sign in

        # Verify and decode the Apple ID token
        try:
            decoded_token = verify_apple_token(identity_token)
        except Exception as e:
            return jsonify({"error": f"Invalid Apple token: {str(e)}"}), 400

        apple_user_id = decoded_token["sub"]
        email = decoded_token.get("email", "")
        email_verified = decoded_token.get("email_verified", False)

        # Check if user exists
        print(f"[DEBUG] Looking for user with apple_id: {apple_user_id}")
        user = User.query.filter_by(apple_id=apple_user_id).first()
        print(f"[DEBUG] User found: {user is not None}")

        if user:
            # Existing user - update login time
            user.update_login_time()
            db.session.commit()

            # Create JWT token
            access_token = create_access_token(identity=str(user.id))

            return (
                jsonify(
                    {
                        "access_token": access_token,
                        "user": user.to_dict(),
                        "is_new_user": False,
                    }
                ),
                200,
            )

        else:
            # New user - create account
            # Use provided user info or defaults
            name = ""
            if user_info:
                first_name = user_info.get("name", {}).get("firstName", "")
                last_name = user_info.get("name", {}).get("lastName", "")
                name = f"{first_name} {last_name}".strip()

            if not name:
                name = email.split("@")[0] if email else "Apple User"

            if not email:
                # Apple private relay case
                email = f"user.{apple_user_id[-8:]}@privaterelay.appleid.com"

            # Create new user
            new_user = User(
                email=email,
                name=name,
                apple_id=apple_user_id,
                email_verified=email_verified,
                is_active=True,
            )

            new_user.update_login_time()

            db.session.add(new_user)
            db.session.commit()

            # Create JWT token
            access_token = create_access_token(identity=str(new_user.id))

            return (
                jsonify(
                    {
                        "access_token": access_token,
                        "user": new_user.to_dict(),
                        "is_new_user": True,
                    }
                ),
                201,
            )

    except Exception as e:
        return jsonify({"error": f"Authentication failed: {str(e)}"}), 500


@auth_bp.route("/signin", methods=["POST"])
def signin():
    """Traditional email/password sign in."""
    try:
        data = request.get_json()

        if not data or not all(k in data for k in ["email", "password"]):
            return jsonify({"error": "Email and password required"}), 400

        email = data["email"].lower().strip()
        password = data["password"]

        # Find user by email
        user = User.query.filter_by(email=email).first()

        if not user or not user.check_password(password):
            return jsonify({"error": "Invalid email or password"}), 401

        if not user.is_active:
            return jsonify({"error": "Account is deactivated"}), 401

        # Update login time
        user.update_login_time()
        db.session.commit()

        # Create JWT token
        access_token = create_access_token(identity=str(user.id))

        return jsonify({"access_token": access_token, "user": user.to_dict()}), 200

    except Exception as e:
        return jsonify({"error": f"Sign in failed: {str(e)}"}), 500


@auth_bp.route("/signup", methods=["POST"])
def signup():
    """Traditional email/password sign up."""
    try:
        data = request.get_json()

        if not data or not all(k in data for k in ["email", "password", "name"]):
            return jsonify({"error": "Email, password, and name required"}), 400

        email = data["email"].lower().strip()
        password = data["password"]
        name = data["name"].strip()

        # Validate input
        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters"}), 400

        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400

        # Check if user already exists
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "User with this email already exists"}), 409

        # Create new user
        new_user = User(email=email, name=name, password=password)

        new_user.update_login_time()

        db.session.add(new_user)
        db.session.commit()

        # Create JWT token
        access_token = create_access_token(identity=str(new_user.id))

        return (
            jsonify(
                {
                    "access_token": access_token,
                    "user": new_user.to_dict(),
                    "is_new_user": True,
                }
            ),
            201,
        )

    except Exception as e:
        return jsonify({"error": f"Sign up failed: {str(e)}"}), 500


@auth_bp.route("/refresh", methods=["POST"])
@jwt_required()
def refresh_token():
    """Refresh an existing JWT token."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)

        if not user or not user.is_active:
            return jsonify({"error": "User not found or deactivated"}), 404

        # Create new token
        access_token = create_access_token(identity=str(user.id))

        return jsonify({"access_token": access_token, "user": user.to_dict()}), 200

    except Exception as e:
        return jsonify({"error": f"Token refresh failed: {str(e)}"}), 500


@auth_bp.route("/profile", methods=["GET"])
@jwt_required()
def get_profile():
    """Get current user profile."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)

        if not user:
            return jsonify({"error": "User not found"}), 404

        return jsonify({"user": user.to_dict(include_sensitive=True)}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to get profile: {str(e)}"}), 500


@auth_bp.route("/profile", methods=["PUT"])
@jwt_required()
def update_profile():
    """Update current user profile."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)

        if not user:
            return jsonify({"error": "User not found"}), 404

        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Update allowed fields
        if "name" in data:
            user.name = data["name"].strip()
        if "display_name" in data:
            user.display_name = data["display_name"].strip()
        if "timezone" in data:
            user.timezone = data["timezone"]
        if "language_preference" in data:
            user.language_preference = data["language_preference"]
        if "study_preferences" in data:
            user.study_preferences = data["study_preferences"]

        user.updated_at = datetime.now(timezone.utc)
        db.session.commit()

        return jsonify({"user": user.to_dict(include_sensitive=True)}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to update profile: {str(e)}"}), 500


def verify_apple_token(token):
    """
    Verify Apple ID token.
    In production, this should verify against Apple's public keys.
    For development, we'll do basic JWT decoding.
    """
    try:
        # Check if this is a simulator test token
        if token.startswith("simulator-test-token-"):
            # Create mock decoded token for simulator testing
            timestamp = token.split("-")[-1]
            return {
                "sub": f"simulator_user_{timestamp}",
                "email": "demo.user@privaterelay.appleid.com",
                "email_verified": True,
                "iss": "https://appleid.apple.com",
                "aud": "com.cognition.curator",
                "exp": int(float(timestamp)) + 3600,  # 1 hour from creation
                "iat": int(float(timestamp)),
            }

        # For real Apple tokens, decode without verification in development
        # In production, you should verify against Apple's public keys
        decoded = jwt_lib.decode(token, options={"verify_signature": False})
        return decoded
    except Exception as e:
        raise ValueError(f"Invalid Apple token: {str(e)}")


def get_apple_public_keys():
    """
    Fetch Apple's public keys for token verification.
    Use this in production for proper token verification.
    """
    try:
        response = requests.get("https://appleid.apple.com/auth/keys")
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise ValueError(f"Failed to fetch Apple public keys: {str(e)}")
