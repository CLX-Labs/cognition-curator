"""
API blueprints for Cognition Curator Server.
"""

from .auth import auth_bp
from .users import users_bp
from .decks import decks_bp
from .flashcards import flashcards_bp
from .analytics import analytics_bp
from .sync import sync_bp

__all__ = [
    'auth_bp',
    'users_bp', 
    'decks_bp',
    'flashcards_bp',
    'analytics_bp',
    'sync_bp'
] 