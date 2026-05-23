"""
Database configuration and setup for Cognition Curator.
"""

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# Initialize SQLAlchemy
db = SQLAlchemy()
migrate = Migrate()


def init_db(app):
    """Initialize database with Flask app."""
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Import all models to ensure they're registered with SQLAlchemy
    from .models import (
        User, Deck, Flashcard, ReviewSession,
        StudySession, PerformanceMetric, LearningInsight, RetentionData
    )
    
    return db 