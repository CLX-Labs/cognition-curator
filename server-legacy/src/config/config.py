"""Configuration settings for Cognition Curator Server"""

import os
from datetime import timedelta
from typing import Optional


class Config:
    """Base configuration class"""

    # Flask Configuration
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
    
    # Database Configuration
    SQLALCHEMY_DATABASE_URI: str = os.environ.get(
        "DATABASE_URL", "postgresql://localhost/cognition_curator"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS: bool = False
    SQLALCHEMY_RECORD_QUERIES: bool = True
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 10,
        "pool_recycle": 120,
        "pool_pre_ping": True,
    }

    # JWT Configuration
    JWT_SECRET_KEY: str = os.environ.get("JWT_SECRET_KEY", "jwt-secret-key-change-me")
    JWT_ACCESS_TOKEN_EXPIRES: timedelta = timedelta(
        seconds=int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRES", "86400"))
    )
    JWT_ALGORITHM: str = "HS256"

    # CORS Configuration
    CORS_ORIGINS: list[str] = os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,cognitioncurator://"
    ).split(",")

    # AI/ML Configuration
    OPENAI_API_KEY: Optional[str] = os.environ.get("OPENAI_API_KEY")
    LANGGRAPH_API_URL: Optional[str] = os.environ.get("LANGGRAPH_API_URL")
    LANGGRAPH_API_KEY: Optional[str] = os.environ.get("LANGGRAPH_API_KEY")

    # Redis Configuration
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

    # File Upload Configuration
    MAX_CONTENT_LENGTH: int = int(os.environ.get("MAX_CONTENT_LENGTH", "16777216"))  # 16MB
    UPLOAD_FOLDER: str = os.environ.get("UPLOAD_FOLDER", "uploads/")

    # Rate Limiting
    RATELIMIT_STORAGE_URL: str = os.environ.get(
        "RATE_LIMIT_STORAGE_URL", "redis://localhost:6379/1"
    )
    RATELIMIT_DEFAULT: str = "100 per hour"

    # Logging Configuration
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")
    SENTRY_DSN: Optional[str] = os.environ.get("SENTRY_DSN")

    # Celery Configuration
    CELERY_BROKER_URL: str = os.environ.get(
        "CELERY_BROKER_URL", "redis://localhost:6379/2"
    )
    CELERY_RESULT_BACKEND: str = os.environ.get(
        "CELERY_RESULT_BACKEND", "redis://localhost:6379/3"
    )

    # Email Configuration
    MAIL_SERVER: str = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT: int = int(os.environ.get("MAIL_PORT", "587"))
    MAIL_USE_TLS: bool = os.environ.get("MAIL_USE_TLS", "True").lower() == "true"
    MAIL_USERNAME: Optional[str] = os.environ.get("MAIL_USERNAME")
    MAIL_PASSWORD: Optional[str] = os.environ.get("MAIL_PASSWORD")

    # API Configuration
    API_TITLE: str = "Cognition Curator API"
    API_VERSION: str = "v1"
    OPENAPI_VERSION: str = "3.0.2"

    @staticmethod
    def init_app(app) -> None:
        """Initialize application with configuration"""
        pass


class DevelopmentConfig(Config):
    """Development configuration"""

    DEBUG: bool = True
    TESTING: bool = False
    
    # More verbose logging in development
    LOG_LEVEL: str = "DEBUG"
    
    # Disable rate limiting in development
    RATELIMIT_ENABLED: bool = False
    
    # Development database
    SQLALCHEMY_DATABASE_URI: str = os.environ.get(
        "DATABASE_URL", "postgresql://localhost/cognition_curator_dev"
    )


class TestingConfig(Config):
    """Testing configuration"""

    DEBUG: bool = True
    TESTING: bool = True
    
    # Use in-memory SQLite for fast testing
    SQLALCHEMY_DATABASE_URI: str = os.environ.get(
        "TEST_DATABASE_URL", "sqlite:///:memory:"
    )
    
    # Disable CSRF for testing
    WTF_CSRF_ENABLED: bool = False
    
    # Disable rate limiting in tests
    RATELIMIT_ENABLED: bool = False
    
    # Use shorter JWT expiration for testing
    JWT_ACCESS_TOKEN_EXPIRES: timedelta = timedelta(minutes=5)
    
    # Mock AI services in tests
    OPENAI_API_KEY: str = "test-openai-key"
    LANGGRAPH_API_URL: str = "http://localhost:8000"
    LANGGRAPH_API_KEY: str = "test-langgraph-key"


class ProductionConfig(Config):
    """Production configuration"""

    DEBUG: bool = False
    TESTING: bool = False
    
    # Stricter settings for production
    SQLALCHEMY_RECORD_QUERIES: bool = False
    
    # Enable rate limiting
    RATELIMIT_ENABLED: bool = True
    
    # Production logging
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "WARNING")
    
    @staticmethod
    def init_app(app) -> None:
        """Initialize production app"""
        Config.init_app(app)
        
        # Production-specific initialization
        import logging
        from logging.handlers import RotatingFileHandler
        
        if not app.debug:
            # Set up file logging
            file_handler = RotatingFileHandler(
                "logs/cognition_curator.log", maxBytes=10240, backupCount=10
            )
            file_handler.setFormatter(
                logging.Formatter(
                    "%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]"
                )
            )
            file_handler.setLevel(logging.INFO)
            app.logger.addHandler(file_handler)
            
            app.logger.setLevel(logging.INFO)
            app.logger.info("Cognition Curator startup")


# Configuration mapping
config = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
} 