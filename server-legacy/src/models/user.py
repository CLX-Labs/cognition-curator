"""
User model for authentication and profile management.
Supports both traditional email/password and Apple Sign In authentication.
"""

import uuid
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from werkzeug.security import check_password_hash, generate_password_hash

from ..database import db


class User(db.Model):
    """
    User model with comprehensive profile and analytics tracking.
    Supports Apple Sign In and traditional authentication methods.
    """

    __tablename__ = "users"

    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Authentication fields
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(
        String(255), nullable=True
    )  # Nullable for Apple Sign In users
    apple_id = Column(
        String(255), unique=True, nullable=True, index=True
    )  # Apple Sign In identifier

    # Profile information
    name = Column(String(100), nullable=False)
    display_name = Column(String(100), nullable=True)
    profile_picture_url = Column(Text, nullable=True)

    # Account status
    is_active = Column(Boolean, default=True, nullable=False)
    is_premium = Column(Boolean, default=False, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Study preferences and settings
    study_preferences = Column(
        JSONB, default=dict, nullable=False
    )  # Notification prefs, study goals, etc.
    timezone = Column(String(50), default="UTC", nullable=False)
    language_preference = Column(String(10), default="en", nullable=False)

    # Quick analytics (for fast queries)
    total_study_time_minutes = Column(Integer, default=0, nullable=False)
    current_streak_days = Column(Integer, default=0, nullable=False)
    longest_streak_days = Column(Integer, default=0, nullable=False)
    total_cards_reviewed = Column(Integer, default=0, nullable=False)
    total_decks_created = Column(Integer, default=0, nullable=False)

    # Performance metrics (updated by analytics jobs)
    overall_accuracy_rate = Column(Float, default=0.0, nullable=False)  # 0.0 to 1.0
    average_session_length_minutes = Column(Float, default=0.0, nullable=False)
    mastery_rate = Column(
        Float, default=0.0, nullable=False
    )  # Cards mastered / total cards

    # Relationships
    decks = relationship("Deck", back_populates="user", cascade="all, delete-orphan")
    review_sessions = relationship(
        "ReviewSession", back_populates="user", cascade="all, delete-orphan"
    )
    study_sessions = relationship(
        "StudySession", back_populates="user", cascade="all, delete-orphan"
    )
    performance_metrics = relationship(
        "PerformanceMetric", back_populates="user", cascade="all, delete-orphan"
    )
    learning_insights = relationship(
        "LearningInsight", back_populates="user", cascade="all, delete-orphan"
    )
    retention_data = relationship(
        "RetentionData", back_populates="user", cascade="all, delete-orphan"
    )

    def __init__(self, email, name, **kwargs):
        """Initialize a new user."""
        self.email = email.lower().strip()
        self.name = name.strip()
        self.display_name = kwargs.get("display_name", name.strip())

        # Handle Apple Sign In
        if "apple_id" in kwargs:
            self.apple_id = kwargs["apple_id"]
            self.email_verified = True  # Apple Sign In emails are pre-verified

        # Handle traditional password
        if "password" in kwargs:
            self.set_password(kwargs["password"])

        # Set other fields
        for key, value in kwargs.items():
            if hasattr(self, key) and key not in ["password", "apple_id"]:
                setattr(self, key, value)

    def set_password(self, password):
        """Hash and set the user's password."""
        if password:
            self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Check if the provided password matches the user's password."""
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    def is_apple_user(self):
        """Check if this user signed in with Apple."""
        return self.apple_id is not None

    def update_login_time(self):
        """Update the last login timestamp."""
        self.last_login_at = datetime.now(timezone.utc)

    def update_study_stats(
        self, session_duration_minutes=0, cards_reviewed=0, accuracy_rate=None
    ):
        """
        Update user's study statistics.
        Called after each study session.
        """
        self.total_study_time_minutes += session_duration_minutes
        self.total_cards_reviewed += cards_reviewed

        if accuracy_rate is not None:
            # Safely get study sessions count
            try:
                study_sessions = getattr(self, "study_sessions", None)
                if study_sessions is not None:
                    total_sessions = len(study_sessions)
                else:
                    # Fallback: query the database directly
                    from .analytics import StudySession

                    total_sessions = StudySession.query.filter_by(
                        user_id=self.id
                    ).count()

                if total_sessions > 0:
                    self.overall_accuracy_rate = (
                        self.overall_accuracy_rate * (total_sessions - 1)
                        + accuracy_rate
                    ) / total_sessions
                else:
                    self.overall_accuracy_rate = accuracy_rate
            except Exception as e:
                # Fallback to simple average if there's any issue
                print(f"Warning: Could not calculate weighted average accuracy: {e}")
                self.overall_accuracy_rate = accuracy_rate or 0.0

        self.updated_at = datetime.now(timezone.utc)

    def update_streak(self, studied_today=True):
        """
        Update the user's study streak.
        Called daily by background jobs.
        """
        if studied_today:
            self.current_streak_days += 1
            if self.current_streak_days > self.longest_streak_days:
                self.longest_streak_days = self.current_streak_days
        else:
            self.current_streak_days = 0

        self.updated_at = datetime.now(timezone.utc)

    def get_study_level(self):
        """
        Calculate user's study level based on total cards reviewed.
        Returns level (int) and progress to next level (0.0-1.0).
        """
        cards = self.total_cards_reviewed

        # Level progression: 50, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000+
        levels = [0, 50, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]

        for i, threshold in enumerate(levels[1:], 1):
            if cards < threshold:
                prev_threshold = levels[i - 1]
                progress = (cards - prev_threshold) / (threshold - prev_threshold)
                return i, progress

        # Max level reached
        return len(levels) - 1, 1.0

    def to_dict(self, include_sensitive=False):
        """Convert user to dictionary for API responses."""
        level, level_progress = self.get_study_level()

        data = {
            "id": str(self.id),
            "email": self.email
            if include_sensitive
            else self.email.split("@")[0] + "@***",
            "name": self.name,
            "display_name": self.display_name,
            "profile_picture_url": self.profile_picture_url,
            "is_premium": self.is_premium,
            "is_apple_user": self.is_apple_user(),
            "created_at": self.created_at.isoformat(),
            "last_login_at": self.last_login_at.isoformat()
            if self.last_login_at
            else None,
            "timezone": self.timezone,
            "language_preference": self.language_preference,
            # Study statistics
            "total_study_time_minutes": self.total_study_time_minutes,
            "current_streak_days": self.current_streak_days,
            "longest_streak_days": self.longest_streak_days,
            "total_cards_reviewed": self.total_cards_reviewed,
            "total_decks_created": self.total_decks_created,
            "overall_accuracy_rate": round(self.overall_accuracy_rate, 3),
            "average_session_length_minutes": round(
                self.average_session_length_minutes, 1
            ),
            "mastery_rate": round(self.mastery_rate, 3),
            # Calculated fields
            "study_level": level,
            "level_progress": round(level_progress, 3),
            # Preferences
            "study_preferences": self.study_preferences,
        }

        return data

    def __repr__(self):
        return f"<User {self.email}>"
