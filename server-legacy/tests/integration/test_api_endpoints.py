"""
Integration tests for API endpoints.

These tests verify that the API endpoints work correctly with the actual
Flask application and database.

Run with: pytest tests/integration/test_api_endpoints.py -v
"""

import pytest

# Test data
SIMULATOR_TOKEN = "simulator-test-token-1705739520"


class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_health_check(self, client):
        """Test /health endpoint returns healthy status."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.get_json()

        assert "status" in data
        assert "checks" in data
        assert "timestamp" in data
        assert data["service"] == "cognition-curator-api"

    def test_ping(self, client):
        """Test /ping endpoint returns ok status."""
        response = client.get("/ping")

        assert response.status_code == 200
        data = response.get_json()

        assert data["status"] == "ok"
        assert data["message"] == "pong"


class TestAuthEndpoints:
    """Test authentication endpoints."""

    def test_apple_signin_missing_token(self, client):
        """Test Apple Sign In fails without identity token."""
        response = client.post(
            "/api/auth/apple-signin", json={}, content_type="application/json"
        )

        assert response.status_code == 400
        data = response.get_json()
        assert "error" in data
        assert "token" in data["error"].lower()

    def test_apple_signin_simulator_token(self, client):
        """Test Apple Sign In works with simulator token."""
        response = client.post(
            "/api/auth/apple-signin",
            json={"identity_token": SIMULATOR_TOKEN},
            content_type="application/json",
        )

        assert response.status_code in [200, 201]
        data = response.get_json()

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

    def test_get_profile_without_auth(self, client):
        """Test profile endpoint requires authentication."""
        response = client.get("/api/auth/profile")

        assert response.status_code == 401
        data = response.get_json()
        assert "error" in data

    def test_get_profile_with_auth(self, client, auth_token):
        """Test profile endpoint returns user data with valid token."""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = client.get("/api/auth/profile", headers=headers)

        assert response.status_code == 200
        data = response.get_json()

        assert "user" in data
        user = data["user"]
        assert "id" in user
        assert "email" in user
        assert "name" in user


class TestDecksEndpoints:
    """Test deck management endpoints."""

    def test_list_decks_without_auth(self, client):
        """Test listing decks requires authentication."""
        response = client.get("/api/decks/")

        assert response.status_code == 401

    def test_list_decks_with_auth(self, client, auth_token):
        """Test listing decks returns deck array."""
        response = client.get(
            "/api/decks/", headers={"Authorization": f"Bearer {auth_token}"}
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "decks" in data
        assert isinstance(data["decks"], list)

    def test_create_deck_without_name(self, client, auth_token):
        """Test creating deck fails without name."""
        response = client.post(
            "/api/decks/",
            json={},
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 400
        data = response.get_json()
        assert "error" in data

    def test_create_deck_success(self, client, auth_token):
        """Test creating deck succeeds with valid data."""
        deck_data = {
            "name": "Test Deck from API Tests",
            "description": "A test deck created by automated tests",
            "category": "Testing",
            "color": "#FF5733",
        }

        response = client.post(
            "/api/decks/",
            json=deck_data,
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 201
        data = response.get_json()

        assert "deck" in data
        deck = data["deck"]
        assert deck["name"] == deck_data["name"]
        assert "id" in deck

    def test_get_deck_not_found(self, client, auth_token):
        """Test getting non-existent deck returns 404."""
        response = client.get(
            "/api/decks/00000000-0000-0000-0000-000000000000",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 404


class TestAIEndpoints:
    """Test AI-related endpoints."""

    def test_topic_suggestions(self, client):
        """Test topic suggestions endpoint (no auth required)."""
        response = client.get("/api/ai/topics/suggestions")

        assert response.status_code == 200
        data = response.get_json()

        assert "popular" in data
        assert "categories" in data
        assert isinstance(data["popular"], list)
        assert len(data["popular"]) > 0

    def test_provider_info(self, client):
        """Test AI provider info endpoint."""
        response = client.get("/api/ai/provider/info")

        assert response.status_code == 200
        data = response.get_json()

        assert "available" in data

    def test_generate_flashcards_missing_topic(self, client, auth_token):
        """Test flashcard generation fails without topic."""
        response = client.post(
            "/api/ai/generate-flashcards",
            json={"number_of_cards": 5},
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 400
        data = response.get_json()
        assert "error" in data

    def test_generate_flashcards_invalid_card_count(self, client, auth_token):
        """Test flashcard generation fails with invalid card count."""
        response = client.post(
            "/api/ai/generate-flashcards",
            json={"topic": "Python", "number_of_cards": 100},
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 400
        data = response.get_json()
        assert "error" in data

    def test_generate_flashcards_invalid_difficulty(self, client, auth_token):
        """Test flashcard generation fails with invalid difficulty."""
        response = client.post(
            "/api/ai/generate-flashcards",
            json={"topic": "Python", "difficulty": "impossible"},
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 400
        data = response.get_json()
        assert "error" in data

    @pytest.mark.slow
    @pytest.mark.ai
    @pytest.mark.external
    def test_generate_flashcards_success(self, client, auth_token):
        """Test flashcard generation succeeds with valid data.

        Note: This test requires the AI provider to be properly configured
        and will make actual API calls.
        """
        response = client.post(
            "/api/ai/generate-flashcards",
            json={
                "topic": "Python list comprehensions",
                "number_of_cards": 2,
                "difficulty": "easy",
            },
            headers={"Authorization": f"Bearer {auth_token}"},
            content_type="application/json",
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "cards" in data
        assert "topic" in data
        assert "total_generated" in data
        assert len(data["cards"]) > 0

        # Verify card structure
        card = data["cards"][0]
        assert "question" in card
        assert "answer" in card


class TestAnalyticsEndpoints:
    """Test analytics endpoints."""

    def test_dashboard_without_auth(self, client):
        """Test dashboard requires authentication."""
        response = client.get("/api/analytics/dashboard")

        assert response.status_code == 401

    def test_dashboard_with_auth(self, client, auth_token):
        """Test dashboard returns analytics data."""
        response = client.get(
            "/api/analytics/dashboard",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "user_stats" in data
        assert "cards_due_today" in data


# Fixtures for this test module
@pytest.fixture(scope="module")
def app():
    """Create application for testing."""
    from src.app import create_app

    app = create_app("testing")
    app.config["TESTING"] = True

    yield app


@pytest.fixture(scope="module")
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture(scope="module")
def auth_token(client):
    """Get authentication token for tests."""
    response = client.post(
        "/api/auth/apple-signin",
        json={"identity_token": SIMULATOR_TOKEN},
        content_type="application/json",
    )

    if response.status_code in [200, 201]:
        data = response.get_json()
        return data.get("access_token")

    pytest.skip("Could not obtain auth token for tests")
