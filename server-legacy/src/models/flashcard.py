"""
Flashcard model with advanced spaced repetition algorithm.
"""

from datetime import datetime, timezone, timedelta
from enum import Enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid
import math

from ..database import db


class CardStatus(Enum):
    """Flashcard status for spaced repetition."""
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    MASTERED = "mastered"


class DifficultyLevel(Enum):
    """Difficulty levels for spaced repetition adjustment."""
    AGAIN = 1  # Forgot completely
    HARD = 2   # Remembered with difficulty
    GOOD = 3   # Remembered normally
    EASY = 4   # Remembered easily


class Flashcard(db.Model):
    """
    Flashcard model with advanced spaced repetition algorithm.
    Based on SM-2 algorithm with modern improvements.
    """
    __tablename__ = 'flashcards'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Content
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    hint = Column(Text, nullable=True)
    explanation = Column(Text, nullable=True)
    
    # Organization
    deck_id = Column(UUID(as_uuid=True), ForeignKey('decks.id'), nullable=False, index=True)
    tags = Column(JSONB, default=list, nullable=False)  # List of string tags
    
    # Card status
    is_active = Column(Boolean, default=True, nullable=False)
    status = Column(SQLEnum(CardStatus), default=CardStatus.NEW, nullable=False, index=True)
    
    # Spaced repetition algorithm fields
    ease_factor = Column(Float, default=2.5, nullable=False)  # SM-2 ease factor (min 1.3)
    interval_days = Column(Integer, default=0, nullable=False)  # Days until next review
    repetitions = Column(Integer, default=0, nullable=False)  # Number of successful reviews
    
    # Review scheduling
    next_review_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), 
                             nullable=False, index=True)
    last_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Performance tracking
    total_reviews = Column(Integer, default=0, nullable=False)
    correct_reviews = Column(Integer, default=0, nullable=False)
    streak_correct = Column(Integer, default=0, nullable=False)
    longest_streak = Column(Integer, default=0, nullable=False)
    
    # Time tracking
    total_study_time_seconds = Column(Integer, default=0, nullable=False)
    average_response_time_seconds = Column(Float, default=0.0, nullable=False)
    
    # Difficulty and learning patterns
    perceived_difficulty = Column(Float, default=0.0, nullable=False)  # 0.0 to 1.0
    learning_velocity = Column(Float, default=1.0, nullable=False)  # Learning speed multiplier
    mistake_count = Column(Integer, default=0, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), 
                       onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    
    # AI-generated content tracking
    ai_generated = Column(Boolean, default=False, nullable=False)
    ai_generation_prompt = Column(Text, nullable=True)
    ai_model_used = Column(String(100), nullable=True)
    
    # Additional metadata
    custom_fields = Column(JSONB, default=dict, nullable=False)
    source_reference = Column(Text, nullable=True)  # Book, URL, etc.
    
    # Relationships
    deck = relationship("Deck", back_populates="flashcards")
    review_history = relationship("ReviewSession", back_populates="flashcard", cascade="all, delete-orphan")
    
    def __init__(self, front, back, deck_id, **kwargs):
        """Initialize a new flashcard."""
        self.front = front.strip()
        self.back = back.strip()
        self.deck_id = deck_id
        
        # Set optional fields
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
    
    def review_card(self, difficulty: DifficultyLevel, response_time_seconds=None):
        """
        Process a card review using improved SM-2 algorithm.
        
        Args:
            difficulty: DifficultyLevel enum indicating how well the card was remembered
            response_time_seconds: Time taken to respond (optional)
        
        Returns:
            dict: Review result with new scheduling information
        """
        now = datetime.now(timezone.utc)
        self.last_reviewed_at = now
        self.total_reviews += 1
        
        # Update response time
        if response_time_seconds:
            self.total_study_time_seconds += response_time_seconds
            if self.total_reviews > 0:
                self.average_response_time_seconds = self.total_study_time_seconds / self.total_reviews
        
        # Handle different difficulty levels
        if difficulty == DifficultyLevel.AGAIN:
            # Card was forgotten
            self._handle_incorrect_review()
        else:
            # Card was remembered
            self._handle_correct_review(difficulty)
        
        # Update status based on progress
        self._update_card_status()
        
        # Calculate next review date
        self._schedule_next_review(difficulty)
        
        self.updated_at = now
        
        return {
            'card_id': str(self.id),
            'status': self.status.value,
            'next_review_date': self.next_review_date.isoformat(),
            'interval_days': self.interval_days,
            'ease_factor': round(self.ease_factor, 2),
            'accuracy_rate': self.get_accuracy_rate()
        }
    
    def _handle_correct_review(self, difficulty: DifficultyLevel):
        """Handle a correct review."""
        self.correct_reviews += 1
        self.streak_correct += 1
        self.longest_streak = max(self.longest_streak, self.streak_correct)
        
        # Update ease factor based on difficulty
        if difficulty == DifficultyLevel.EASY:
            self.ease_factor += 0.15
            self.learning_velocity = min(2.0, self.learning_velocity + 0.1)
        elif difficulty == DifficultyLevel.GOOD:
            self.ease_factor += 0.0  # No change
        elif difficulty == DifficultyLevel.HARD:
            self.ease_factor -= 0.15
            self.learning_velocity = max(0.5, self.learning_velocity - 0.05)
        
        # Ensure ease factor stays within bounds
        self.ease_factor = max(1.3, min(3.0, self.ease_factor))
        
        # Update perceived difficulty
        difficulty_score = {
            DifficultyLevel.EASY: 0.2,
            DifficultyLevel.GOOD: 0.5,
            DifficultyLevel.HARD: 0.8
        }.get(difficulty, 0.5)
        
        # Weighted average with previous difficulty
        alpha = 0.3  # Learning rate
        self.perceived_difficulty = (1 - alpha) * self.perceived_difficulty + alpha * difficulty_score
        
        self.repetitions += 1
    
    def _handle_incorrect_review(self):
        """Handle an incorrect review."""
        self.streak_correct = 0
        self.mistake_count += 1
        self.repetitions = 0  # Reset repetitions
        
        # Increase perceived difficulty
        alpha = 0.4  # Higher learning rate for mistakes
        self.perceived_difficulty = (1 - alpha) * self.perceived_difficulty + alpha * 1.0
        
        # Slightly decrease learning velocity
        self.learning_velocity = max(0.3, self.learning_velocity - 0.1)
        
        # Reset ease factor if too many mistakes
        if self.mistake_count > 3:
            self.ease_factor = max(1.3, self.ease_factor - 0.2)
    
    def _update_card_status(self):
        """Update card status based on performance."""
        if self.repetitions == 0:
            if self.total_reviews == 0:
                self.status = CardStatus.NEW
            else:
                self.status = CardStatus.LEARNING
        elif self.repetitions < 3:
            self.status = CardStatus.LEARNING
        elif self.ease_factor >= 2.0 and self.get_accuracy_rate() >= 0.8:
            self.status = CardStatus.MASTERED
        else:
            self.status = CardStatus.REVIEW
    
    def _schedule_next_review(self, difficulty: DifficultyLevel):
        """Schedule the next review using improved SM-2 algorithm."""
        if difficulty == DifficultyLevel.AGAIN:
            # Reset to beginning for forgotten cards
            self.interval_days = 1
        elif self.repetitions == 1:
            self.interval_days = 1
        elif self.repetitions == 2:
            self.interval_days = 6
        else:
            # Standard SM-2 formula with learning velocity adjustment
            self.interval_days = max(1, int(
                self.interval_days * self.ease_factor * self.learning_velocity
            ))
        
        # Apply some randomization to avoid review clustering
        randomization = 0.1  # 10% variance
        variance = int(self.interval_days * randomization)
        if variance > 0:
            import random
            self.interval_days += random.randint(-variance, variance)
        
        # Ensure minimum interval
        self.interval_days = max(1, self.interval_days)
        
        # Cap maximum interval (optional)
        max_interval = 365  # 1 year
        self.interval_days = min(self.interval_days, max_interval)
        
        # Set next review date
        self.next_review_date = datetime.now(timezone.utc) + timedelta(days=self.interval_days)
    
    def get_accuracy_rate(self):
        """Calculate accuracy rate for this card."""
        if self.total_reviews == 0:
            return 0.0
        return self.correct_reviews / self.total_reviews
    
    def is_due(self):
        """Check if card is due for review."""
        return self.next_review_date <= datetime.now(timezone.utc)
    
    def is_new(self):
        """Check if card is new (never reviewed)."""
        return self.status == CardStatus.NEW
    
    def is_learning(self):
        """Check if card is in learning phase."""
        return self.status == CardStatus.LEARNING
    
    def is_mastered(self):
        """Check if card is mastered."""
        return self.status == CardStatus.MASTERED
    
    def get_difficulty_score(self):
        """
        Calculate a difficulty score based on multiple factors.
        Returns value between 0.0 (easy) and 1.0 (difficult).
        """
        factors = [
            self.perceived_difficulty * 0.4,  # User-reported difficulty
            (1.0 - self.get_accuracy_rate()) * 0.3,  # Error rate
            min(1.0, self.mistake_count / 5) * 0.2,  # Mistake frequency
            max(0.0, (3.0 - self.ease_factor) / 1.7) * 0.1  # Ease factor inverse
        ]
        return min(1.0, sum(factors))
    
    def get_mastery_level(self):
        """
        Calculate mastery level as percentage.
        Returns value between 0.0 and 1.0.
        """
        if self.is_mastered():
            return 1.0
        
        factors = [
            min(1.0, self.repetitions / 5) * 0.3,  # Repetition progress
            self.get_accuracy_rate() * 0.3,  # Accuracy
            min(1.0, self.streak_correct / 3) * 0.2,  # Current streak
            (self.ease_factor - 1.3) / 1.7 * 0.2  # Ease factor
        ]
        return min(1.0, sum(factors))
    
    def to_dict(self, include_content=True, include_analytics=False):
        """Convert flashcard to dictionary for API responses."""
        data = {
            'id': str(self.id),
            'deck_id': str(self.deck_id),
            'is_active': self.is_active,
            'status': self.status.value,
            'tags': self.tags,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_reviewed_at': self.last_reviewed_at.isoformat() if self.last_reviewed_at else None,
            'next_review_date': self.next_review_date.isoformat(),
            'is_due': self.is_due(),
            'ai_generated': self.ai_generated,
        }
        
        if include_content:
            data.update({
                'front': self.front,
                'back': self.back,
                'hint': self.hint,
                'explanation': self.explanation,
            })
        
        if include_analytics:
            data.update({
                'ease_factor': round(self.ease_factor, 2),
                'interval_days': self.interval_days,
                'repetitions': self.repetitions,
                'total_reviews': self.total_reviews,
                'correct_reviews': self.correct_reviews,
                'accuracy_rate': round(self.get_accuracy_rate(), 3),
                'streak_correct': self.streak_correct,
                'longest_streak': self.longest_streak,
                'mistake_count': self.mistake_count,
                'total_study_time_seconds': self.total_study_time_seconds,
                'average_response_time_seconds': round(self.average_response_time_seconds, 1),
                'perceived_difficulty': round(self.perceived_difficulty, 3),
                'learning_velocity': round(self.learning_velocity, 3),
                'difficulty_score': round(self.get_difficulty_score(), 3),
                'mastery_level': round(self.get_mastery_level(), 3),
            })
        
        return data
    
    def __repr__(self):
        return f'<Flashcard {self.front[:30]}... ({self.status.value})>' 