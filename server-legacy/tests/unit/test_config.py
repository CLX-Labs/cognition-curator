"""Unit tests for configuration module"""

import os
import pytest
from datetime import timedelta

from src.config.config import Config, DevelopmentConfig, TestingConfig, ProductionConfig


class TestConfig:
    """Test base configuration class"""
    
    def test_default_values(self):
        """Test default configuration values"""
        config = Config()
        
        assert config.SECRET_KEY == "dev-secret-key-change-me"
        assert config.SQLALCHEMY_TRACK_MODIFICATIONS is False
        assert config.JWT_ALGORITHM == "HS256"
        assert isinstance(config.JWT_ACCESS_TOKEN_EXPIRES, timedelta)
        assert config.API_TITLE == "Cognition Curator API"
        assert config.API_VERSION == "v1"
    
    def test_environment_override(self, monkeypatch):
        """Test configuration override from environment variables"""
        monkeypatch.setenv("SECRET_KEY", "env-secret-key")
        monkeypatch.setenv("JWT_ACCESS_TOKEN_EXPIRES", "3600")
        
        config = Config()
        
        assert config.SECRET_KEY == "env-secret-key"
        assert config.JWT_ACCESS_TOKEN_EXPIRES == timedelta(seconds=3600)
    
    def test_cors_origins_parsing(self, monkeypatch):
        """Test CORS origins parsing from environment"""
        monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,https://app.example.com")
        
        config = Config()
        
        assert len(config.CORS_ORIGINS) == 2
        assert "http://localhost:3000" in config.CORS_ORIGINS
        assert "https://app.example.com" in config.CORS_ORIGINS


class TestDevelopmentConfig:
    """Test development configuration"""
    
    def test_development_settings(self):
        """Test development-specific settings"""
        config = DevelopmentConfig()
        
        assert config.DEBUG is True
        assert config.TESTING is False
        assert config.LOG_LEVEL == "DEBUG"
        assert config.RATELIMIT_ENABLED is False
    
    def test_development_database_url(self):
        """Test development database URL"""
        config = DevelopmentConfig()
        
        assert "cognition_curator_dev" in config.SQLALCHEMY_DATABASE_URI


class TestTestingConfig:
    """Test testing configuration"""
    
    def test_testing_settings(self):
        """Test testing-specific settings"""
        config = TestingConfig()
        
        assert config.DEBUG is True
        assert config.TESTING is True
        assert config.RATELIMIT_ENABLED is False
        assert config.WTF_CSRF_ENABLED is False
    
    def test_testing_database_url(self):
        """Test testing database URL (in-memory SQLite)"""
        config = TestingConfig()
        
        assert config.SQLALCHEMY_DATABASE_URI == "sqlite:///:memory:"
    
    def test_testing_jwt_expiration(self):
        """Test shorter JWT expiration for testing"""
        config = TestingConfig()
        
        assert config.JWT_ACCESS_TOKEN_EXPIRES == timedelta(minutes=5)
    
    def test_mock_ai_keys(self):
        """Test mock AI service keys for testing"""
        config = TestingConfig()
        
        assert config.OPENAI_API_KEY == "test-openai-key"
        assert config.LANGGRAPH_API_URL == "http://localhost:8000"
        assert config.LANGGRAPH_API_KEY == "test-langgraph-key"


class TestProductionConfig:
    """Test production configuration"""
    
    def test_production_settings(self):
        """Test production-specific settings"""
        config = ProductionConfig()
        
        assert config.DEBUG is False
        assert config.TESTING is False
        assert config.RATELIMIT_ENABLED is True
        assert config.SQLALCHEMY_RECORD_QUERIES is False
    
    def test_production_log_level(self):
        """Test production log level"""
        config = ProductionConfig()
        
        assert config.LOG_LEVEL == "WARNING"


@pytest.mark.parametrize("config_name,config_class", [
    ("development", DevelopmentConfig),
    ("testing", TestingConfig),
    ("production", ProductionConfig),
    ("default", DevelopmentConfig),
])
def test_config_mapping(config_name, config_class):
    """Test configuration mapping"""
    from src.config.config import config
    
    assert config[config_name] == config_class 