"""
Deck model for organizing flashcards into collections.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from ..database import db


class Deck(db.Model):
    """
    Deck model for organizing flashcards into study collections.
    """
    __tablename__ = 'decks'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Basic information
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)  # e.g., "Language", "Science", "History"
    
    # Ownership
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    
    # Deck settings
    is_public = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    color = Column(String(7), default='#007AFF', nullable=False)  # Hex color
    icon = Column(String(50), nullable=True)  # SF Symbol name or emoji
    
    # Study configuration
    spaced_repetition_enabled = Column(Boolean, default=True, nullable=False)
    daily_goal_cards = Column(Integer, default=20, nullable=False)
    max_new_cards_per_day = Column(Integer, default=10, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), 
                       onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    last_studied_at = Column(DateTime(timezone=True), nullable=True)
    
    # Analytics (cached for performance)
    total_cards = Column(Integer, default=0, nullable=False)
    cards_due_count = Column(Integer, default=0, nullable=False)
    cards_new_count = Column(Integer, default=0, nullable=False)
    cards_learning_count = Column(Integer, default=0, nullable=False)
    cards_mastered_count = Column(Integer, default=0, nullable=False)
    
    # Performance metrics
    average_accuracy = Column(Float, default=0.0, nullable=False)  # 0.0 to 1.0
    average_study_time_per_card = Column(Float, default=0.0, nullable=False)  # seconds
    total_study_time_minutes = Column(Integer, default=0, nullable=False)
    total_reviews = Column(Integer, default=0, nullable=False)
    
    # Metadata
    tags = Column(JSONB, default=list, nullable=False)  # List of string tags
    custom_fields = Column(JSONB, default=dict, nullable=False)  # Additional metadata
    
    # AI-generated content tracking
    ai_generated = Column(Boolean, default=False, nullable=False)
    ai_generation_prompt = Column(Text, nullable=True)
    ai_model_used = Column(String(100), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="decks")
    flashcards = relationship("Flashcard", back_populates="deck", cascade="all, delete-orphan")
    review_sessions = relationship("ReviewSession", back_populates="deck", cascade="all, delete-orphan")
    
    def __init__(self, name, user_id, **kwargs):
        """Initialize a new deck."""
        self.name = name.strip()
        self.user_id = user_id
        
        # Set optional fields
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
    
    def update_card_counts(self):
        """
        Update cached card counts based on current flashcards.
        Called after card operations.
        """
        from .flashcard import Flashcard, CardStatus
        
        # Count cards by status
        card_counts = db.session.query(
            Flashcard.status,
            db.func.count(Flashcard.id)
        ).filter(
            Flashcard.deck_id == self.id,
            Flashcard.is_active == True
        ).group_by(Flashcard.status).all()
        
        # Reset counts
        self.cards_new_count = 0
        self.cards_learning_count = 0
        self.cards_mastered_count = 0
        self.cards_due_count = 0
        
        # Update counts
        for status, count in card_counts:
            if status == CardStatus.NEW:
                self.cards_new_count = count
            elif status == CardStatus.LEARNING:
                self.cards_learning_count = count
            elif status == CardStatus.MASTERED:
                self.cards_mastered_count = count
        
        # Total active cards
        self.total_cards = sum(count for _, count in card_counts)
        
        # Count due cards (requires checking next_review_date)
        due_count = db.session.query(Flashcard).filter(
            Flashcard.deck_id == self.id,
            Flashcard.is_active == True,
            Flashcard.next_review_date <= datetime.now(timezone.utc)
        ).count()
        self.cards_due_count = due_count
        
        self.updated_at = datetime.now(timezone.utc)
    
    def update_study_stats(self, session_duration_minutes=0, cards_reviewed=0, accuracy_rate=None):
        """
        Update deck study statistics.
        Called after each study session.
        """
        self.total_study_time_minutes += session_duration_minutes
        self.total_reviews += cards_reviewed
        self.last_studied_at = datetime.now(timezone.utc)
        
        if accuracy_rate is not None and self.total_reviews > 0:
            # Update average accuracy using weighted average
            prev_total = self.total_reviews - cards_reviewed
            if prev_total > 0:
                self.average_accuracy = (
                    (self.average_accuracy * prev_total + accuracy_rate * cards_reviewed) / self.total_reviews
                )
            else:
                self.average_accuracy = accuracy_rate
        
        # Update average study time per card
        if self.total_reviews > 0:
            self.average_study_time_per_card = (self.total_study_time_minutes * 60) / self.total_reviews
        
        self.updated_at = datetime.now(timezone.utc)
    
    def get_study_progress(self):
        """
        Calculate study progress metrics.
        Returns dictionary with progress information.
        """
        if self.total_cards == 0:
            return {
                'completion_rate': 0.0,
                'mastery_rate': 0.0,
                'cards_remaining': 0,
                'estimated_completion_days': 0
            }
        
        completion_rate = (self.cards_mastered_count + self.cards_learning_count) / self.total_cards
        mastery_rate = self.cards_mastered_count / self.total_cards
        cards_remaining = self.cards_new_count + self.cards_learning_count
        
        # Estimate completion time based on daily goal
        estimated_days = 0
        if self.daily_goal_cards > 0 and cards_remaining > 0:
            estimated_days = max(1, cards_remaining // self.daily_goal_cards)
        
        return {
            'completion_rate': round(completion_rate, 3),
            'mastery_rate': round(mastery_rate, 3),
            'cards_remaining': cards_remaining,
            'estimated_completion_days': estimated_days
        }
    
    def get_due_cards(self, limit=None):
        """
        Get cards that are due for review.
        Returns query for due flashcards.
        """
        from .flashcard import Flashcard
        
        query = db.session.query(Flashcard).filter(
            Flashcard.deck_id == self.id,
            Flashcard.is_active == True,
            Flashcard.next_review_date <= datetime.now(timezone.utc)
        ).order_by(Flashcard.next_review_date.asc())
        
        if limit:
            query = query.limit(limit)
        
        return query
    
    def get_new_cards(self, limit=None):
        """
        Get new cards for study.
        Returns query for new flashcards.
        """
        from .flashcard import Flashcard, CardStatus
        
        query = db.session.query(Flashcard).filter(
            Flashcard.deck_id == self.id,
            Flashcard.is_active == True,
            Flashcard.status == CardStatus.NEW
        ).order_by(Flashcard.created_at.asc())
        
        # Respect daily new card limit
        if limit is None:
            limit = self.max_new_cards_per_day
        else:
            limit = min(limit, self.max_new_cards_per_day)
        
        if limit:
            query = query.limit(limit)
        
        return query
    
    def to_dict(self, include_stats=True):
        """Convert deck to dictionary for API responses."""
        data = {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'user_id': str(self.user_id),
            'is_public': self.is_public,
            'is_active': self.is_active,
            'color': self.color,
            'icon': self.icon,
            'spaced_repetition_enabled': self.spaced_repetition_enabled,
            'daily_goal_cards': self.daily_goal_cards,
            'max_new_cards_per_day': self.max_new_cards_per_day,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_studied_at': self.last_studied_at.isoformat() if self.last_studied_at else None,
            'tags': self.tags,
            'ai_generated': self.ai_generated,
        }
        
        if include_stats:
            progress = self.get_study_progress()
            data.update({
                'total_cards': self.total_cards,
                'cards_due_count': self.cards_due_count,
                'cards_new_count': self.cards_new_count,
                'cards_learning_count': self.cards_learning_count,
                'cards_mastered_count': self.cards_mastered_count,
                'average_accuracy': round(self.average_accuracy, 3),
                'average_study_time_per_card': round(self.average_study_time_per_card, 1),
                'total_study_time_minutes': self.total_study_time_minutes,
                'total_reviews': self.total_reviews,
                'progress': progress
            })
        
        return data
    
    def __repr__(self):
        return f'<Deck {self.name} ({self.total_cards} cards)>' 