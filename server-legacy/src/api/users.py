"""
User management API endpoints.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from ..database import db
from ..models.user import User

users_bp = Blueprint('users', __name__)


@users_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current user information."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({'user': user.to_dict(include_sensitive=True)}), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get user: {str(e)}'}), 500


@users_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_user_stats():
    """Get detailed user statistics."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        level, progress = user.get_study_level()
        
        stats = {
            'basic_stats': user.to_dict(),
            'study_level': {
                'current_level': level,
                'progress_to_next': progress,
                'cards_for_next_level': max(0, [50, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000][min(level, 9)] - user.total_cards_reviewed)
            },
            'achievements': {
                'first_review': user.total_cards_reviewed > 0,
                'first_streak': user.longest_streak_days > 0,
                'week_warrior': user.longest_streak_days >= 7,
                'month_master': user.longest_streak_days >= 30,
                'accuracy_ace': user.overall_accuracy_rate >= 0.9,
                'speed_learner': user.average_session_length_minutes <= 15,
                'dedicated_learner': user.total_study_time_minutes >= 1000
            }
        }
        
        return jsonify(stats), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get user stats: {str(e)}'}), 500 