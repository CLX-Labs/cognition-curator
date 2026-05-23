"""
ReviewSession model for tracking individual flashcard reviews.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from ..database import db
from .flashcard import DifficultyLevel


class ReviewSession(db.Model):
    """
    Individual review session for a flashcard.
    Tracks detailed performance and timing data.
    """
    __tablename__ = 'review_sessions'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Relationships
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    deck_id = Column(UUID(as_uuid=True), ForeignKey('decks.id'), nullable=False, index=True)
    flashcard_id = Column(UUID(as_uuid=True), ForeignKey('flashcards.id'), nullable=False, index=True)
    
    # Review performance
    difficulty_rating = Column(Integer, nullable=False)  # DifficultyLevel enum value
    was_correct = Column(Boolean, nullable=False)
    response_time_seconds = Column(Float, nullable=False)
    
    # Context information
    session_type = Column(String(50), default='regular', nullable=False)  # regular, cramming, testing
    review_context = Column(String(100), nullable=True)  # mobile, web, etc.
    
    # Spaced repetition data (snapshot at time of review)
    ease_factor_before = Column(Float, nullable=False)
    ease_factor_after = Column(Float, nullable=False)
    interval_before_days = Column(Integer, nullable=False)
    interval_after_days = Column(Integer, nullable=False)
    repetitions_before = Column(Integer, nullable=False)
    repetitions_after = Column(Integer, nullable=False)
    
    # Learning analytics
    confidence_level = Column(Float, nullable=True)  # User's self-reported confidence (0.0-1.0)
    hint_used = Column(Boolean, default=False, nullable=False)
    multiple_attempts = Column(Boolean, default=False, nullable=False)
    
    # Timing and environment
    reviewed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    time_of_day_hour = Column(Integer, nullable=False)  # 0-23
    day_of_week = Column(Integer, nullable=False)  # 0-6 (Monday=0)
    
    # Device and platform information
    platform = Column(String(50), nullable=True)  # iOS, Android, Web
    device_type = Column(String(50), nullable=True)  # iPhone, iPad, Desktop
    app_version = Column(String(20), nullable=True)
    
    # Additional metadata
    tags = Column(JSONB, default=list, nullable=False)
    custom_fields = Column(JSONB, default=dict, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="review_sessions")
    deck = relationship("Deck", back_populates="review_sessions")
    flashcard = relationship("Flashcard", back_populates="review_history")
    
    def __init__(self, user_id, deck_id, flashcard_id, difficulty_rating, was_correct, 
                 response_time_seconds, **kwargs):
        """Initialize a new review session."""
        self.user_id = user_id
        self.deck_id = deck_id
        self.flashcard_id = flashcard_id
        self.difficulty_rating = difficulty_rating
        self.was_correct = was_correct
        self.response_time_seconds = response_time_seconds
        
        # Set time-based fields
        now = datetime.now(timezone.utc)
        self.reviewed_at = now
        self.time_of_day_hour = now.hour
        self.day_of_week = now.weekday()  # Monday = 0
        
        # Set optional fields
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
    
    def get_difficulty_rating_name(self):
        """Get human-readable difficulty rating name."""
        try:
            return DifficultyLevel(self.difficulty_rating).name.lower()
        except ValueError:
            return 'unknown'
    
    def get_performance_score(self):
        """
        Calculate a performance score for this review.
        Returns value between 0.0 and 1.0.
        """
        if not self.was_correct:
            return 0.0
        
        # Base score for correctness
        score = 0.6
        
        # Bonus for difficulty rating
        difficulty_bonus = {
            DifficultyLevel.EASY.value: 0.4,
            DifficultyLevel.GOOD.value: 0.3,
            DifficultyLevel.HARD.value: 0.1,
            DifficultyLevel.AGAIN.value: 0.0
        }.get(self.difficulty_rating, 0.0)
        score += difficulty_bonus
        
        # Bonus for fast response (if reasonable)
        if 1 <= self.response_time_seconds <= 30:
            time_bonus = max(0, (30 - self.response_time_seconds) / 30 * 0.1)
            score += time_bonus
        
        # Penalty for using hints
        if self.hint_used:
            score *= 0.8
        
        # Penalty for multiple attempts
        if self.multiple_attempts:
            score *= 0.7
        
        return min(1.0, score)
    
    def is_optimal_time(self):
        """
        Check if this review was done at an optimal time.
        Based on research about learning and memory.
        """
        # Optimal hours: 10-12 AM and 2-4 PM
        optimal_hours = [10, 11, 14, 15]
        return self.time_of_day_hour in optimal_hours
    
    def get_session_quality(self):
        """
        Calculate overall session quality based on multiple factors.
        Returns value between 0.0 and 1.0.
        """
        factors = []
        
        # Performance factor
        factors.append(self.get_performance_score() * 0.4)
        
        # Response time factor (optimal range: 3-15 seconds)
        if 3 <= self.response_time_seconds <= 15:
            time_factor = 1.0
        elif self.response_time_seconds < 3:
            time_factor = 0.6  # Too fast, might be guessing
        elif self.response_time_seconds <= 30:
            time_factor = 0.8  # Reasonable but slow
        else:
            time_factor = 0.4  # Very slow
        factors.append(time_factor * 0.3)
        
        # Time of day factor
        time_of_day_factor = 1.0 if self.is_optimal_time() else 0.8
        factors.append(time_of_day_factor * 0.1)
        
        # Confidence factor (if available)
        if self.confidence_level is not None:
            factors.append(self.confidence_level * 0.2)
        else:
            factors.append(0.7 * 0.2)  # Default moderate confidence
        
        return sum(factors)
    
    def to_dict(self, include_analytics=False):
        """Convert review session to dictionary for API responses."""
        data = {
            'id': str(self.id),
            'user_id': str(self.user_id),
            'deck_id': str(self.deck_id),
            'flashcard_id': str(self.flashcard_id),
            'difficulty_rating': self.difficulty_rating,
            'difficulty_name': self.get_difficulty_rating_name(),
            'was_correct': self.was_correct,
            'response_time_seconds': round(self.response_time_seconds, 2),
            'session_type': self.session_type,
            'hint_used': self.hint_used,
            'multiple_attempts': self.multiple_attempts,
            'reviewed_at': self.reviewed_at.isoformat(),
            'time_of_day_hour': self.time_of_day_hour,
            'day_of_week': self.day_of_week,
            'platform': self.platform,
            'device_type': self.device_type,
            'tags': self.tags,
        }
        
        if include_analytics:
            data.update({
                'ease_factor_before': round(self.ease_factor_before, 2),
                'ease_factor_after': round(self.ease_factor_after, 2),
                'interval_before_days': self.interval_before_days,
                'interval_after_days': self.interval_after_days,
                'repetitions_before': self.repetitions_before,
                'repetitions_after': self.repetitions_after,
                'confidence_level': self.confidence_level,
                'performance_score': round(self.get_performance_score(), 3),
                'session_quality': round(self.get_session_quality(), 3),
                'is_optimal_time': self.is_optimal_time(),
            })
        
        return data
    
    def __repr__(self):
        correct_str = "✓" if self.was_correct else "✗"
        return f'<ReviewSession {correct_str} {self.get_difficulty_rating_name()} ({self.response_time_seconds:.1f}s)>' 