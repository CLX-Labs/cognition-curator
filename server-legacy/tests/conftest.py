"""Global test configuration and fixtures for Cognition Curator Server"""

import os
import tempfile
from typing import Any, Generator
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_sqlalchemy import SQLAlchemy

# Import your app factory and models here
# from src.app import create_app
# from src.models import db, User, Deck, Flashcard, ReviewSession


@pytest.fixture(scope="session")
def app() -> Generator[Flask, None, None]:
    """Create application for the tests."""
    # Mock the create_app import until we create it
    with patch("src.app.create_app") as mock_create_app:
        # Create a minimal Flask app for testing
        test_app = Flask(__name__)
        test_app.config.update({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "SECRET_KEY": "test-secret-key",
            "JWT_SECRET_KEY": "test-jwt-secret",
            "WTF_CSRF_ENABLED": False,
        })
        
        mock_create_app.return_value = test_app
        
        # Create application context
        ctx = test_app.app_context()
        ctx.push()
        
        yield test_app
        
        ctx.pop()


@pytest.fixture(scope="function")
def db(app: Flask) -> Generator[SQLAlchemy, None, None]:
    """Create database for the tests."""
    # Mock SQLAlchemy until we create the actual models
    _db = Mock(spec=SQLAlchemy)
    _db.create_all = Mock()
    _db.drop_all = Mock()
    _db.session = Mock()
    _db.session.commit = Mock()
    _db.session.rollback = Mock()
    _db.session.remove = Mock()
    
    # Setup database
    _db.create_all()
    
    yield _db
    
    # Cleanup database
    _db.session.remove()
    _db.drop_all()


@pytest.fixture(scope="function")
def client(app: Flask) -> FlaskClient:
    """Create test client."""
    return app.test_client()


@pytest.fixture(scope="function")
def runner(app: Flask):
    """Create test runner."""
    return app.test_cli_runner()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Mock authentication headers."""
    return {
        "Authorization": "Bearer test-jwt-token",
        "Content-Type": "application/json"
    }


@pytest.fixture
def sample_user_data() -> dict[str, Any]:
    """Sample user data for testing."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "email": "test@example.com",
        "username": "testuser",
        "password": "SecurePassword123!",
        "first_name": "Test",
        "last_name": "User",
        "is_premium": False,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
    }


@pytest.fixture
def sample_deck_data() -> dict[str, Any]:
    """Sample deck data for testing."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "Test Deck",
        "description": "A test deck for learning",
        "is_public": False,
        "is_premium": False,
        "user_id": "550e8400-e29b-41d4-a716-446655440000",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
    }


@pytest.fixture
def sample_flashcard_data() -> dict[str, Any]:
    """Sample flashcard data for testing."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "question": "What is the capital of France?",
        "answer": "Paris",
        "hint": "It's also known as the City of Light",
        "difficulty": 1,
        "deck_id": "550e8400-e29b-41d4-a716-446655440001",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
    }


@pytest.fixture
def sample_review_session_data() -> dict[str, Any]:
    """Sample review session data for testing."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440003",
        "flashcard_id": "550e8400-e29b-41d4-a716-446655440002",
        "user_id": "550e8400-e29b-41d4-a716-446655440000",
        "quality": 4,  # Good
        "ease_factor": 2.5,
        "interval": 1.0,
        "repetitions": 1,
        "next_review": "2024-01-02T00:00:00Z",
        "reviewed_at": "2024-01-01T00:00:00Z"
    }


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI client for testing AI features."""
    with patch("openai.OpenAI") as mock_client:
        mock_instance = Mock()
        mock_client.return_value = mock_instance
        
        # Mock chat completions
        mock_instance.chat.completions.create.return_value = Mock(
            choices=[
                Mock(
                    message=Mock(
                        content='{"cards": [{"question": "Test Q", "answer": "Test A"}]}'
                    )
                )
            ]
        )
        
        yield mock_instance


@pytest.fixture
def mock_langgraph_client():
    """Mock LangGraph client for testing AI deck generation."""
    with patch("requests.post") as mock_post:
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "deck": {
                "name": "AI Generated Deck",
                "cards": [
                    {"question": "AI Question 1", "answer": "AI Answer 1"},
                    {"question": "AI Question 2", "answer": "AI Answer 2"}
                ]
            }
        }
        mock_post.return_value = mock_response
        
        yield mock_post


@pytest.fixture
def temp_upload_dir():
    """Create temporary directory for file uploads."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield temp_dir


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )
    config.addinivalue_line(
        "markers", "ai: mark test as requiring AI API access"
    )
    config.addinivalue_line(
        "markers", "database: mark test as requiring database access"
    )
    config.addinivalue_line(
        "markers", "auth: mark test as authentication related"
    )
    config.addinivalue_line(
        "markers", "api: mark test as API endpoint test"
    )
    config.addinivalue_line(
        "markers", "external: mark test as making external API calls"
    )


def pytest_collection_modifyitems(config, items):
    """Automatically mark tests based on their location."""
    for item in items:
        # Mark all tests in unit/ directory as unit tests
        if "unit/" in str(item.fspath):
            item.add_marker(pytest.mark.unit)
        
        # Mark all tests in integration/ directory as integration tests
        if "integration/" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
        
        # Mark tests that contain "slow" in their name
        if "slow" in item.name:
            item.add_marker(pytest.mark.slow)
        
        # Mark tests that contain "ai" in their name
        if "ai" in item.name.lower():
            item.add_marker(pytest.mark.ai)
        
        # Mark tests in auth related modules
        if "auth" in str(item.fspath):
            item.add_marker(pytest.mark.auth)
        
        # Mark API tests
        if "api" in str(item.fspath) or "test_api" in item.name:
            item.add_marker(pytest.mark.api)


# Test database utilities
class DatabaseTestMixin:
    """Mixin class for database testing utilities."""
    
    @staticmethod
    def create_user(db, **kwargs):
        """Create a test user."""
        # This will be implemented once we have the User model
        pass
    
    @staticmethod
    def create_deck(db, user=None, **kwargs):
        """Create a test deck."""
        # This will be implemented once we have the Deck model
        pass
    
    @staticmethod
    def create_flashcard(db, deck=None, **kwargs):
        """Create a test flashcard."""
        # This will be implemented once we have the Flashcard model
        pass
    
    @staticmethod
    def create_review_session(db, flashcard=None, user=None, **kwargs):
        """Create a test review session."""
        # This will be implemented once we have the ReviewSession model
        pass


# API testing utilities
class APITestMixin:
    """Mixin class for API testing utilities."""
    
    def post_json(self, client, url, data, headers=None):
        """Helper method to post JSON data."""
        if headers is None:
            headers = {"Content-Type": "application/json"}
        return client.post(url, json=data, headers=headers)
    
    def put_json(self, client, url, data, headers=None):
        """Helper method to put JSON data."""
        if headers is None:
            headers = {"Content-Type": "application/json"}
        return client.put(url, json=data, headers=headers)
    
    def assert_api_error(self, response, status_code, error_message=None):
        """Assert API error response."""
        assert response.status_code == status_code
        if error_message:
            data = response.get_json()
            assert "error" in data
            assert error_message in data["error"]
    
    def assert_api_success(self, response, status_code=200):
        """Assert API success response."""
        assert response.status_code == status_code
        data = response.get_json()
        assert "error" not in data or data["error"] is None 