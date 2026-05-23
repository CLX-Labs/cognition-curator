"""
Live API integration tests.

These tests run against the actual running server to verify endpoints work correctly.
Make sure the server is running on localhost:5001 before running these tests.

Run with: pytest tests/integration/test_live_api.py -v -m "not slow"

To run all tests including slow AI tests:
    pytest tests/integration/test_live_api.py -v
"""

import os

import pytest
import requests

# Configuration
BASE_URL = os.getenv("TEST_API_URL", "http://127.0.0.1:5001")
SIMULATOR_TOKEN = "simulator-test-token-1705739520"


def get_auth_token():
    """Get authentication token from the server."""
    response = requests.post(
        f"{BASE_URL}/api/auth/apple-signin", json={"identity_token": SIMULATOR_TOKEN}
    )
    if response.status_code in [200, 201]:
        return response.json().get("access_token")
    return None


class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_health_check(self):
        """Test /health endpoint returns healthy status."""
        response = requests.get(f"{BASE_URL}/health")

        assert response.status_code == 200
        data = response.json()

        assert "status" in data
        assert data["status"] == "healthy"
        assert "checks" in data
        assert "timestamp" in data
        assert data["service"] == "cognition-curator-api"

        # Verify all checks
        checks = data["checks"]
        assert "database" in checks
        assert "environment" in checks
        assert "flask" in checks

    def test_ping(self):
        """Test /ping endpoint returns ok status."""
        response = requests.get(f"{BASE_URL}/ping")

        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "ok"
        assert data["message"] == "pong"


class TestAuthEndpoints:
    """Test authentication endpoints."""

    def test_apple_signin_missing_token(self):
        """Test Apple Sign In fails without identity token."""
        response = requests.post(f"{BASE_URL}/api/auth/apple-signin", json={})

        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        assert "token" in data["error"].lower()

    def test_apple_signin_simulator_token(self):
        """Test Apple Sign In works with simulator token."""
        response = requests.post(
            f"{BASE_URL}/api/auth/apple-signin",
            json={"identity_token": SIMULATOR_TOKEN},
        )

        assert response.status_code in [200, 201]
        data = response.json()

        assert "access_token" in data
        assert "user" in data
        assert "is_new_user" in data

        # Verify user data structure
        user = data["user"]
        assert "id" in user
        assert "email" in user
        assert "name" in user
        assert "is_apple_user" in user
        assert user["is_apple_user"] is True

        # Verify the token is a valid JWT format
        token = data["access_token"]
        assert len(token.split(".")) == 3  # JWT has 3 parts

    def test_get_profile_without_auth(self):
        """Test profile endpoint requires authentication."""
        response = requests.get(f"{BASE_URL}/api/auth/profile")

        assert response.status_code == 401
        data = response.json()
        assert "error" in data

    def test_get_profile_with_auth(self):
        """Test profile endpoint returns user data with valid token."""
        token = get_auth_token()
        assert token is not None, "Failed to get auth token"

        response = requests.get(
            f"{BASE_URL}/api/auth/profile", headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert "user" in data
        user = data["user"]
        assert "id" in user
        assert "email" in user
        assert "name" in user
        assert "total_cards_reviewed" in user
        assert "current_streak_days" in user


class TestDecksEndpoints:
    """Test deck management endpoints."""

    def test_list_decks_without_auth(self):
        """Test listing decks requires authentication."""
        response = requests.get(f"{BASE_URL}/api/decks/")

        assert response.status_code == 401

    def test_list_decks_with_auth(self):
        """Test listing decks returns deck array."""
        token = get_auth_token()
        assert token is not None

        response = requests.get(
            f"{BASE_URL}/api/decks/", headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.json()

        assert "decks" in data
        assert isinstance(data["decks"], list)

    def test_create_deck_without_name(self):
        """Test creating deck fails without name."""
        token = get_auth_token()
        assert token is not None

        response = requests.post(
            f"{BASE_URL}/api/decks/",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_create_and_delete_deck(self):
        """Test creating and deleting a deck."""
        token = get_auth_token()
        assert token is not None

        # Create deck
        deck_data = {
            "name": "Test Deck - API Test",
            "description": "Created by automated tests",
            "category": "Testing",
            "color": "#FF5733",
        }

        create_response = requests.post(
            f"{BASE_URL}/api/decks/",
            json=deck_data,
            headers={"Authorization": f"Bearer {token}"},
        )

        assert create_response.status_code == 201
        created_deck = create_response.json()["deck"]
        deck_id = created_deck["id"]

        assert created_deck["name"] == deck_data["name"]

        # Delete the deck (cleanup)
        delete_response = requests.delete(
            f"{BASE_URL}/api/decks/{deck_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert delete_response.status_code == 200

    def test_get_deck_not_found(self):
        """Test getting non-existent deck returns 404."""
        token = get_auth_token()
        assert token is not None

        response = requests.get(
            f"{BASE_URL}/api/decks/00000000-0000-0000-0000-000000000000",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 404


class TestAIEndpoints:
    """Test AI-related endpoints."""

    def test_topic_suggestions(self):
        """Test topic suggestions endpoint (no auth required)."""
        response = requests.get(f"{BASE_URL}/api/ai/topics/suggestions")

        assert response.status_code == 200
        data = response.json()

        assert "popular" in data
        assert "categories" in data
        assert isinstance(data["popular"], list)
        assert len(data["popular"]) > 0

        # Check we have multiple categories
        categories = data["categories"]
        assert "Programming" in categories
        assert "Language Learning" in categories

    def test_provider_info(self):
        """Test AI provider info endpoint."""
        response = requests.get(f"{BASE_URL}/api/ai/provider/info")

        assert response.status_code == 200
        data = response.json()

        assert "available" in data

    def test_generate_flashcards_missing_topic(self):
        """Test flashcard generation fails without topic."""
        token = get_auth_token()
        assert token is not None

        response = requests.post(
            f"{BASE_URL}/api/ai/generate-flashcards",
            json={"number_of_cards": 5},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_generate_flashcards_invalid_card_count(self):
        """Test flashcard generation fails with invalid card count."""
        token = get_auth_token()
        assert token is not None

        response = requests.post(
            f"{BASE_URL}/api/ai/generate-flashcards",
            json={"topic": "Python", "number_of_cards": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_generate_flashcards_invalid_difficulty(self):
        """Test flashcard generation fails with invalid difficulty."""
        token = get_auth_token()
        assert token is not None

        response = requests.post(
            f"{BASE_URL}/api/ai/generate-flashcards",
            json={"topic": "Python", "difficulty": "impossible"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    @pytest.mark.slow
    @pytest.mark.ai
    @pytest.mark.external
    def test_generate_flashcards_success(self):
        """Test flashcard generation succeeds with valid data.

        Note: This test makes actual API calls to Claude and may take 10-30 seconds.
        Run with: pytest -v -m slow
        """
        token = get_auth_token()
        assert token is not None

        response = requests.post(
            f"{BASE_URL}/api/ai/generate-flashcards",
            json={
                "topic": "Python list comprehensions",
                "number_of_cards": 2,
                "difficulty": "easy",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,  # AI generation can take a while
        )

        assert response.status_code == 200
        data = response.json()

        assert "cards" in data
        assert "topic" in data
        assert "total_generated" in data
        assert "model_version" in data
        assert len(data["cards"]) >= 1

        # Verify card structure
        card = data["cards"][0]
        assert "question" in card
        assert "answer" in card
        assert "confidence" in card
        assert "difficulty" in card


class TestAnalyticsEndpoints:
    """Test analytics endpoints."""

    def test_dashboard_without_auth(self):
        """Test dashboard requires authentication."""
        response = requests.get(f"{BASE_URL}/api/analytics/dashboard")

        assert response.status_code == 401

    def test_dashboard_with_auth(self):
        """Test dashboard returns analytics data."""
        token = get_auth_token()
        assert token is not None

        response = requests.get(
            f"{BASE_URL}/api/analytics/dashboard",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()

        assert "user_stats" in data
        assert "cards_due_today" in data
        assert "recent_sessions" in data
        assert "daily_chart_data" in data
        assert "weekly_summary" in data


# Skip tests if server is not running
def pytest_configure(config):
    """Check if server is running before tests."""
    try:
        response = requests.get(f"{BASE_URL}/ping", timeout=5)
        if response.status_code != 200:
            pytest.exit("Server is not responding correctly")
    except requests.exceptions.ConnectionError:
        pytest.exit(
            f"Server is not running at {BASE_URL}. "
            "Please start the server before running integration tests."
        )
