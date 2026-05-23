"""
Analytics API endpoints for study insights and performance tracking.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timezone, timedelta, date
from sqlalchemy import func, and_, desc

from ..database import db
from ..models.user import User
from ..models.deck import Deck
from ..models.flashcard import Flashcard, CardStatus
from ..models.review_session import ReviewSession
from ..models.analytics import StudySession, PerformanceMetric, LearningInsight

analytics_bp = Blueprint('analytics', __name__)


@analytics_bp.route('/dashboard', methods=['GET'])
@jwt_required()
def get_dashboard():
    """Get comprehensive dashboard analytics for the current user."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Get date range parameters
        days = request.args.get('days', 30, type=int)
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)
        
        # Basic user stats
        user_stats = {
            'total_study_time_minutes': user.total_study_time_minutes,
            'current_streak_days': user.current_streak_days,
            'longest_streak_days': user.longest_streak_days,
            'total_cards_reviewed': user.total_cards_reviewed,
            'total_decks_created': user.total_decks_created,
            'overall_accuracy_rate': round(user.overall_accuracy_rate, 3),
            'study_level': user.get_study_level()[0],
            'level_progress': round(user.get_study_level()[1], 3),
            'mastery_rate': round(user.mastery_rate, 3)
        }
        
        # Recent study sessions
        recent_sessions = StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.started_at >= start_date
        ).order_by(desc(StudySession.started_at)).limit(10).all()
        
        # Daily study time for chart
        daily_stats = db.session.query(
            func.date(StudySession.started_at).label('date'),
            func.sum(StudySession.duration_minutes).label('total_minutes'),
            func.sum(StudySession.cards_reviewed).label('total_cards'),
            func.avg(StudySession.accuracy_rate).label('avg_accuracy')
        ).filter(
            StudySession.user_id == user.id,
            StudySession.started_at >= start_date
        ).group_by(func.date(StudySession.started_at)).all()
        
        # Deck performance
        deck_stats = db.session.query(
            Deck.id, Deck.name, Deck.total_cards, Deck.cards_mastered_count,
            Deck.average_accuracy, Deck.total_study_time_minutes
        ).filter(
            Deck.user_id == user.id,
            Deck.is_active == True
        ).order_by(desc(Deck.total_study_time_minutes)).limit(5).all()
        
        # Cards due today
        cards_due_today = db.session.query(func.count(Flashcard.id)).filter(
            Flashcard.deck_id.in_(
                db.session.query(Deck.id).filter(Deck.user_id == user.id)
            ),
            Flashcard.is_active == True,
            Flashcard.next_review_date <= datetime.now(timezone.utc)
        ).scalar() or 0
        
        # Weekly progress
        week_start = end_date - timedelta(days=7)
        weekly_progress = db.session.query(
            func.sum(StudySession.duration_minutes).label('total_minutes'),
            func.sum(StudySession.cards_reviewed).label('total_cards'),
            func.avg(StudySession.accuracy_rate).label('avg_accuracy'),
            func.count(StudySession.id).label('session_count')
        ).filter(
            StudySession.user_id == user.id,
            StudySession.started_at >= week_start
        ).first()
        
        # Learning insights
        insights = LearningInsight.query.filter(
            LearningInsight.user_id == user.id,
            LearningInsight.is_dismissed == False
        ).order_by(desc(LearningInsight.priority), desc(LearningInsight.generated_at)).limit(3).all()
        
        return jsonify({
            'user_stats': user_stats,
            'cards_due_today': cards_due_today,
            'recent_sessions': [session.to_dict() for session in recent_sessions],
            'daily_chart_data': [
                {
                    'date': stat.date.isoformat(),
                    'study_minutes': int(stat.total_minutes or 0),
                    'cards_reviewed': int(stat.total_cards or 0),
                    'accuracy_rate': round(float(stat.avg_accuracy or 0), 3)
                }
                for stat in daily_stats
            ],
            'top_decks': [
                {
                    'id': str(deck.id),
                    'name': deck.name,
                    'total_cards': deck.total_cards,
                    'mastery_rate': round(deck.cards_mastered_count / max(deck.total_cards, 1), 3),
                    'accuracy_rate': round(deck.average_accuracy, 3),
                    'study_time_minutes': deck.total_study_time_minutes
                }
                for deck in deck_stats
            ],
            'weekly_summary': {
                'total_minutes': int(weekly_progress.total_minutes or 0),
                'total_cards': int(weekly_progress.total_cards or 0),
                'average_accuracy': round(float(weekly_progress.avg_accuracy or 0), 3),
                'session_count': int(weekly_progress.session_count or 0)
            },
            'insights': [
                {
                    'id': str(insight.id),
                    'title': insight.title,
                    'description': insight.description,
                    'category': insight.category,
                    'priority': insight.priority
                }
                for insight in insights
            ]
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get dashboard: {str(e)}'}), 500


@analytics_bp.route('/study-sessions', methods=['GET'])
@jwt_required()
def get_study_sessions():
    """Get detailed study session history."""
    try:
        current_user_id = get_jwt_identity()
        
        # Pagination parameters
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        
        # Filter parameters
        days = request.args.get('days', 30, type=int)
        deck_id = request.args.get('deck_id')
        
        # Build query
        query = StudySession.query.filter(StudySession.user_id == current_user_id)
        
        if days:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            query = query.filter(StudySession.started_at >= start_date)
        
        if deck_id:
            query = query.filter(StudySession.deck_id == deck_id)
        
        # Get paginated results
        sessions = query.order_by(desc(StudySession.started_at)).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        return jsonify({
            'sessions': [session.to_dict(include_analytics=True) for session in sessions.items],
            'pagination': {
                'page': sessions.page,
                'pages': sessions.pages,
                'per_page': sessions.per_page,
                'total': sessions.total,
                'has_next': sessions.has_next,
                'has_prev': sessions.has_prev
            }
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get study sessions: {str(e)}'}), 500


@analytics_bp.route('/performance-trends', methods=['GET'])
@jwt_required()
def get_performance_trends():
    """Get performance trends and learning curve analysis."""
    try:
        current_user_id = get_jwt_identity()
        
        # Date range
        days = request.args.get('days', 30, type=int)
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)
        
        # Get daily performance metrics
        daily_metrics = db.session.query(
            func.date(StudySession.started_at).label('date'),
            func.avg(StudySession.accuracy_rate).label('accuracy'),
            func.avg(StudySession.session_quality_score).label('quality'),
            func.avg(StudySession.average_response_time_seconds).label('response_time'),
            func.sum(StudySession.cards_mastered).label('cards_mastered'),
            func.sum(StudySession.duration_minutes).label('study_time')
        ).filter(
            StudySession.user_id == current_user_id,
            StudySession.started_at >= start_date
        ).group_by(func.date(StudySession.started_at)).order_by('date').all()
        
        # Calculate trends (simple moving averages)
        trend_data = []
        window_size = min(7, len(daily_metrics))  # 7-day moving average
        
        for i, metric in enumerate(daily_metrics):
            if i >= window_size - 1:
                # Calculate moving averages
                window_metrics = daily_metrics[i - window_size + 1:i + 1]
                
                avg_accuracy = sum(m.accuracy or 0 for m in window_metrics) / window_size
                avg_quality = sum(m.quality or 0 for m in window_metrics) / window_size
                avg_response_time = sum(m.response_time or 0 for m in window_metrics) / window_size
                
                trend_data.append({
                    'date': metric.date.isoformat(),
                    'accuracy_trend': round(avg_accuracy, 3),
                    'quality_trend': round(avg_quality, 3),
                    'response_time_trend': round(avg_response_time, 1),
                    'raw_accuracy': round(metric.accuracy or 0, 3),
                    'raw_quality': round(metric.quality or 0, 3),
                    'cards_mastered': int(metric.cards_mastered or 0),
                    'study_time_minutes': int(metric.study_time or 0)
                })
        
        # Category performance (if deck categories exist)
        category_performance = db.session.query(
            Deck.category,
            func.avg(Deck.average_accuracy).label('avg_accuracy'),
            func.sum(Deck.total_study_time_minutes).label('total_time'),
            func.sum(Deck.cards_mastered_count).label('total_mastered'),
            func.count(Deck.id).label('deck_count')
        ).filter(
            Deck.user_id == current_user_id,
            Deck.is_active == True,
            Deck.category.isnot(None)
        ).group_by(Deck.category).all()
        
        return jsonify({
            'trend_data': trend_data,
            'category_performance': [
                {
                    'category': cat.category,
                    'average_accuracy': round(cat.avg_accuracy or 0, 3),
                    'total_study_time': int(cat.total_time or 0),
                    'cards_mastered': int(cat.total_mastered or 0),
                    'deck_count': int(cat.deck_count or 0)
                }
                for cat in category_performance
            ],
            'summary': {
                'total_days': len(daily_metrics),
                'trend_days': len(trend_data),
                'overall_improvement': calculate_improvement_rate(trend_data) if trend_data else 0
            }
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get performance trends: {str(e)}'}), 500


@analytics_bp.route('/card-difficulty', methods=['GET'])
@jwt_required()
def get_card_difficulty_analysis():
    """Get analysis of card difficulty and learning patterns."""
    try:
        current_user_id = get_jwt_identity()
        
        # Get user's decks
        user_decks = db.session.query(Deck.id).filter(Deck.user_id == current_user_id).subquery()
        
        # Difficulty distribution
        difficulty_stats = db.session.query(
            Flashcard.status,
            func.avg(Flashcard.perceived_difficulty).label('avg_difficulty'),
            func.avg(Flashcard.mistake_count).label('avg_mistakes'),
            func.avg(Flashcard.ease_factor).label('avg_ease'),
            func.count(Flashcard.id).label('card_count')
        ).filter(
            Flashcard.deck_id.in_(user_decks),
            Flashcard.is_active == True
        ).group_by(Flashcard.status).all()
        
        # Most difficult cards
        difficult_cards = db.session.query(
            Flashcard.id, Flashcard.front, Flashcard.get_difficulty_score(),
            Flashcard.mistake_count, Flashcard.get_accuracy_rate(),
            Deck.name.label('deck_name')
        ).join(Deck).filter(
            Flashcard.deck_id.in_(user_decks),
            Flashcard.is_active == True,
            Flashcard.total_reviews > 2  # Only cards with some history
        ).order_by(desc(Flashcard.perceived_difficulty)).limit(10).all()
        
        # Learning velocity analysis
        velocity_stats = db.session.query(
            func.avg(Flashcard.learning_velocity).label('avg_velocity'),
            func.min(Flashcard.learning_velocity).label('min_velocity'),
            func.max(Flashcard.learning_velocity).label('max_velocity'),
            func.count(Flashcard.id).label('total_cards')
        ).filter(
            Flashcard.deck_id.in_(user_decks),
            Flashcard.is_active == True
        ).first()
        
        return jsonify({
            'difficulty_distribution': [
                {
                    'status': stat.status.value,
                    'average_difficulty': round(stat.avg_difficulty or 0, 3),
                    'average_mistakes': round(stat.avg_mistakes or 0, 1),
                    'average_ease_factor': round(stat.avg_ease or 0, 2),
                    'card_count': int(stat.card_count or 0)
                }
                for stat in difficulty_stats
            ],
            'most_difficult_cards': [
                {
                    'id': str(card.id),
                    'front': card.front[:100] + '...' if len(card.front) > 100 else card.front,
                    'difficulty_score': round(card.get_difficulty_score(), 3),
                    'mistake_count': card.mistake_count,
                    'accuracy_rate': round(card.get_accuracy_rate(), 3),
                    'deck_name': card.deck_name
                }
                for card in difficult_cards
            ],
            'learning_velocity': {
                'average': round(velocity_stats.avg_velocity or 0, 3),
                'minimum': round(velocity_stats.min_velocity or 0, 3),
                'maximum': round(velocity_stats.max_velocity or 0, 3),
                'total_cards': int(velocity_stats.total_cards or 0)
            }
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get card difficulty analysis: {str(e)}'}), 500


@analytics_bp.route('/time-analysis', methods=['GET'])
@jwt_required()
def get_time_analysis():
    """Get time-based learning pattern analysis."""
    try:
        current_user_id = get_jwt_identity()
        
        days = request.args.get('days', 30, type=int)
        start_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Hour of day analysis
        hourly_stats = db.session.query(
            ReviewSession.time_of_day_hour,
            func.avg(ReviewSession.get_performance_score()).label('avg_performance'),
            func.avg(ReviewSession.response_time_seconds).label('avg_response_time'),
            func.count(ReviewSession.id).label('review_count')
        ).filter(
            ReviewSession.user_id == current_user_id,
            ReviewSession.reviewed_at >= start_date
        ).group_by(ReviewSession.time_of_day_hour).order_by(ReviewSession.time_of_day_hour).all()
        
        # Day of week analysis
        daily_stats = db.session.query(
            ReviewSession.day_of_week,
            func.avg(ReviewSession.get_performance_score()).label('avg_performance'),
            func.sum(func.case([(ReviewSession.was_correct == True, 1)], else_=0)).label('correct_count'),
            func.count(ReviewSession.id).label('total_count')
        ).filter(
            ReviewSession.user_id == current_user_id,
            ReviewSession.reviewed_at >= start_date
        ).group_by(ReviewSession.day_of_week).order_by(ReviewSession.day_of_week).all()
        
        # Study session patterns
        session_patterns = db.session.query(
            func.extract('hour', StudySession.started_at).label('hour'),
            func.avg(StudySession.duration_minutes).label('avg_duration'),
            func.avg(StudySession.session_quality_score).label('avg_quality'),
            func.count(StudySession.id).label('session_count')
        ).filter(
            StudySession.user_id == current_user_id,
            StudySession.started_at >= start_date
        ).group_by(func.extract('hour', StudySession.started_at)).order_by('hour').all()
        
        # Best performance times
        best_hours = sorted(hourly_stats, key=lambda x: x.avg_performance or 0, reverse=True)[:3]
        best_days = sorted(daily_stats, key=lambda x: x.avg_performance or 0, reverse=True)[:3]
        
        day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        
        return jsonify({
            'hourly_performance': [
                {
                    'hour': int(stat.time_of_day_hour),
                    'performance_score': round(stat.avg_performance or 0, 3),
                    'avg_response_time': round(stat.avg_response_time or 0, 1),
                    'review_count': int(stat.review_count or 0)
                }
                for stat in hourly_stats
            ],
            'daily_performance': [
                {
                    'day_of_week': int(stat.day_of_week),
                    'day_name': day_names[stat.day_of_week],
                    'performance_score': round(stat.avg_performance or 0, 3),
                    'accuracy_rate': round((stat.correct_count or 0) / max(stat.total_count or 1, 1), 3),
                    'review_count': int(stat.total_count or 0)
                }
                for stat in daily_stats
            ],
            'session_patterns': [
                {
                    'hour': int(stat.hour),
                    'avg_duration_minutes': round(stat.avg_duration or 0, 1),
                    'avg_quality_score': round(stat.avg_quality or 0, 3),
                    'session_count': int(stat.session_count or 0)
                }
                for stat in session_patterns
            ],
            'recommendations': {
                'best_study_hours': [
                    {
                        'hour': int(stat.time_of_day_hour),
                        'performance_score': round(stat.avg_performance or 0, 3)
                    }
                    for stat in best_hours
                ],
                'best_study_days': [
                    {
                        'day': day_names[stat.day_of_week],
                        'performance_score': round(stat.avg_performance or 0, 3)
                    }
                    for stat in best_days
                ]
            }
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get time analysis: {str(e)}'}), 500


def calculate_improvement_rate(trend_data):
    """Calculate improvement rate from trend data."""
    if len(trend_data) < 2:
        return 0
    
    first_accuracy = trend_data[0]['accuracy_trend']
    last_accuracy = trend_data[-1]['accuracy_trend']
    
    if first_accuracy == 0:
        return 0
    
    return round(((last_accuracy - first_accuracy) / first_accuracy) * 100, 1) 