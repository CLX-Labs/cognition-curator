"""
Advanced analytics models for comprehensive study tracking and insights.
"""

from datetime import datetime, timezone, date
from enum import Enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey, Date
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from ..database import db


class StudySessionType(Enum):
    """Types of study sessions."""
    REGULAR = "regular"
    CRAMMING = "cramming"
    REVIEW = "review"
    TESTING = "testing"
    PRACTICE = "practice"


class StudySession(db.Model):
    """
    Aggregated study session tracking multiple card reviews.
    Represents a complete study session by a user.
    """
    __tablename__ = 'study_sessions'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Relationships
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    deck_id = Column(UUID(as_uuid=True), ForeignKey('decks.id'), nullable=True, index=True)  # Nullable for multi-deck sessions
    
    # Session metadata
    session_type = Column(String(50), default='regular', nullable=False)
    session_name = Column(String(200), nullable=True)  # User-defined name
    
    # Timing
    started_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=False, default=0)
    
    # Performance metrics
    cards_reviewed = Column(Integer, default=0, nullable=False)
    cards_correct = Column(Integer, default=0, nullable=False)
    cards_incorrect = Column(Integer, default=0, nullable=False)
    accuracy_rate = Column(Float, default=0.0, nullable=False)  # 0.0 to 1.0
    
    # Card status changes
    cards_new_studied = Column(Integer, default=0, nullable=False)
    cards_graduated = Column(Integer, default=0, nullable=False)  # Learning -> Review/Mastered
    cards_mastered = Column(Integer, default=0, nullable=False)  # Became mastered
    cards_reset = Column(Integer, default=0, nullable=False)  # Mastered -> Learning
    
    # Time analysis
    average_response_time_seconds = Column(Float, default=0.0, nullable=False)
    total_think_time_seconds = Column(Integer, default=0, nullable=False)
    fastest_response_seconds = Column(Float, nullable=True)
    slowest_response_seconds = Column(Float, nullable=True)
    
    # Quality metrics
    session_quality_score = Column(Float, default=0.0, nullable=False)  # 0.0 to 1.0
    focus_score = Column(Float, default=0.0, nullable=False)  # Based on response time consistency
    difficulty_distribution = Column(JSONB, default=dict, nullable=False)  # Count by difficulty level
    
    # Context information
    platform = Column(String(50), nullable=True)  # iOS, Android, Web
    device_type = Column(String(50), nullable=True)  # iPhone, iPad, Desktop
    app_version = Column(String(20), nullable=True)
    interruptions_count = Column(Integer, default=0, nullable=False)
    
    # Goals and targets
    target_cards = Column(Integer, nullable=True)  # User's goal for this session
    target_duration_minutes = Column(Integer, nullable=True)
    goal_achieved = Column(Boolean, default=False, nullable=False)
    
    # Additional metadata
    tags = Column(JSONB, default=list, nullable=False)
    notes = Column(Text, nullable=True)
    custom_fields = Column(JSONB, default=dict, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="study_sessions")
    
    def __init__(self, user_id, started_at=None, **kwargs):
        """Initialize a new study session."""
        self.user_id = user_id
        self.started_at = started_at or datetime.now(timezone.utc)
        
        # Set optional fields
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
    
    def end_session(self):
        """End the study session and calculate final metrics."""
        if self.ended_at is None:
            self.ended_at = datetime.now(timezone.utc)
            self.duration_minutes = int((self.ended_at - self.started_at).total_seconds() / 60)
        
        # Calculate accuracy rate
        if self.cards_reviewed > 0:
            self.accuracy_rate = self.cards_correct / self.cards_reviewed
        
        # Calculate quality score
        self.session_quality_score = self._calculate_quality_score()
        
        # Check if goal was achieved
        self.goal_achieved = self._check_goal_achievement()
    
    def _calculate_quality_score(self):
        """Calculate overall session quality score."""
        factors = []
        
        # Accuracy factor (40% weight)
        factors.append(self.accuracy_rate * 0.4)
        
        # Duration factor (20% weight) - optimal range: 15-45 minutes
        if 15 <= self.duration_minutes <= 45:
            duration_factor = 1.0
        elif self.duration_minutes < 15:
            duration_factor = self.duration_minutes / 15.0
        else:
            duration_factor = max(0.3, 45.0 / self.duration_minutes)
        factors.append(duration_factor * 0.2)
        
        # Focus factor (20% weight)
        factors.append(self.focus_score * 0.2)
        
        # Progress factor (20% weight)
        if self.cards_reviewed > 0:
            progress_factor = (self.cards_graduated + self.cards_mastered) / self.cards_reviewed
        else:
            progress_factor = 0.0
        factors.append(progress_factor * 0.2)
        
        return sum(factors)
    
    def _check_goal_achievement(self):
        """Check if session goals were achieved."""
        if self.target_cards and self.cards_reviewed < self.target_cards:
            return False
        if self.target_duration_minutes and self.duration_minutes < self.target_duration_minutes:
            return False
        return True
    
    def calculate_focus_score(self, response_times):
        """
        Calculate focus score based on response time consistency.
        Lower variance indicates better focus.
        """
        if not response_times or len(response_times) < 3:
            self.focus_score = 0.5  # Default moderate score
            return
        
        import statistics
        mean_time = statistics.mean(response_times)
        stdev_time = statistics.stdev(response_times)
        
        # Calculate coefficient of variation
        if mean_time > 0:
            cv = stdev_time / mean_time
            # Lower CV = higher focus (invert and normalize)
            self.focus_score = max(0.0, min(1.0, 1.0 - (cv / 2.0)))
        else:
            self.focus_score = 0.5
    
    def get_performance_insights(self):
        """Generate performance insights for this session."""
        insights = []
        
        # Accuracy insights
        if self.accuracy_rate >= 0.9:
            insights.append("Excellent accuracy! You're mastering these cards.")
        elif self.accuracy_rate >= 0.7:
            insights.append("Good accuracy. Keep reviewing to improve retention.")
        else:
            insights.append("Focus on understanding difficult cards better.")
        
        # Duration insights
        if self.duration_minutes < 10:
            insights.append("Consider longer study sessions for better retention.")
        elif self.duration_minutes > 60:
            insights.append("Take breaks during long sessions to maintain focus.")
        
        # Focus insights
        if self.focus_score >= 0.8:
            insights.append("Great focus maintained throughout the session!")
        elif self.focus_score <= 0.4:
            insights.append("Try minimizing distractions for better focus.")
        
        # Progress insights
        if self.cards_mastered > 0:
            insights.append(f"Congratulations! {self.cards_mastered} cards mastered.")
        
        return insights
    
    def to_dict(self, include_analytics=False):
        """Convert study session to dictionary for API responses."""
        data = {
            'id': str(self.id),
            'user_id': str(self.user_id),
            'deck_id': str(self.deck_id) if self.deck_id else None,
            'session_type': self.session_type,
            'session_name': self.session_name,
            'started_at': self.started_at.isoformat(),
            'ended_at': self.ended_at.isoformat() if self.ended_at else None,
            'duration_minutes': self.duration_minutes,
            'cards_reviewed': self.cards_reviewed,
            'cards_correct': self.cards_correct,
            'cards_incorrect': self.cards_incorrect,
            'accuracy_rate': round(self.accuracy_rate, 3),
            'session_quality_score': round(self.session_quality_score, 3),
            'goal_achieved': self.goal_achieved,
            'platform': self.platform,
            'tags': self.tags,
        }
        
        if include_analytics:
            data.update({
                'cards_new_studied': self.cards_new_studied,
                'cards_graduated': self.cards_graduated,
                'cards_mastered': self.cards_mastered,
                'cards_reset': self.cards_reset,
                'average_response_time_seconds': round(self.average_response_time_seconds, 1),
                'total_think_time_seconds': self.total_think_time_seconds,
                'fastest_response_seconds': self.fastest_response_seconds,
                'slowest_response_seconds': self.slowest_response_seconds,
                'focus_score': round(self.focus_score, 3),
                'difficulty_distribution': self.difficulty_distribution,
                'interruptions_count': self.interruptions_count,
                'target_cards': self.target_cards,
                'target_duration_minutes': self.target_duration_minutes,
                'insights': self.get_performance_insights(),
            })
        
        return data


class PerformanceMetric(db.Model):
    """
    Daily/weekly/monthly aggregated performance metrics.
    """
    __tablename__ = 'performance_metrics'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Relationships
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    
    # Time period
    metric_date = Column(Date, nullable=False, index=True)
    metric_type = Column(String(20), nullable=False, index=True)  # daily, weekly, monthly
    
    # Study volume
    total_study_time_minutes = Column(Integer, default=0, nullable=False)
    total_sessions = Column(Integer, default=0, nullable=False)
    total_cards_reviewed = Column(Integer, default=0, nullable=False)
    unique_decks_studied = Column(Integer, default=0, nullable=False)
    
    # Performance
    overall_accuracy = Column(Float, default=0.0, nullable=False)
    average_session_quality = Column(Float, default=0.0, nullable=False)
    cards_mastered = Column(Integer, default=0, nullable=False)
    cards_learned = Column(Integer, default=0, nullable=False)
    
    # Consistency
    study_streak_days = Column(Integer, default=0, nullable=False)
    goal_achievement_rate = Column(Float, default=0.0, nullable=False)
    average_session_length = Column(Float, default=0.0, nullable=False)
    
    # Insights
    strongest_categories = Column(JSONB, default=list, nullable=False)
    weakest_categories = Column(JSONB, default=list, nullable=False)
    improvement_suggestions = Column(JSONB, default=list, nullable=False)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="performance_metrics")


class LearningInsight(db.Model):
    """
    AI-generated learning insights and recommendations.
    """
    __tablename__ = 'learning_insights'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Relationships
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    
    # Insight metadata
    insight_type = Column(String(50), nullable=False, index=True)  # pattern, recommendation, achievement
    category = Column(String(100), nullable=False)  # study_habits, performance, motivation
    priority = Column(String(20), default='medium', nullable=False)  # low, medium, high
    
    # Content
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    action_items = Column(JSONB, default=list, nullable=False)  # List of suggested actions
    
    # Supporting data
    evidence_data = Column(JSONB, default=dict, nullable=False)  # Data supporting the insight
    confidence_score = Column(Float, default=0.0, nullable=False)  # AI confidence in insight
    
    # User interaction
    is_read = Column(Boolean, default=False, nullable=False)
    is_dismissed = Column(Boolean, default=False, nullable=False)
    user_rating = Column(Integer, nullable=True)  # 1-5 stars
    user_feedback = Column(Text, nullable=True)
    
    # Timing
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    acted_upon_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="learning_insights")


class RetentionData(db.Model):
    """
    Long-term retention tracking and forgetting curve analysis.
    """
    __tablename__ = 'retention_data'
    
    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Relationships
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    flashcard_id = Column(UUID(as_uuid=True), ForeignKey('flashcards.id'), nullable=False, index=True)
    
    # Retention measurement
    measurement_date = Column(Date, nullable=False, index=True)
    days_since_last_review = Column(Integer, nullable=False)
    retention_strength = Column(Float, nullable=False)  # 0.0 to 1.0
    
    # Forgetting curve parameters
    initial_strength = Column(Float, nullable=False)
    decay_rate = Column(Float, nullable=False)
    stability_factor = Column(Float, nullable=False)
    
    # Context
    review_context = Column(String(100), nullable=True)
    environmental_factors = Column(JSONB, default=dict, nullable=False)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="retention_data") 