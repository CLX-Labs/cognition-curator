"""
Main Flask application for Cognition Curator Server.
"""

import os
import sys
from datetime import datetime
from pathlib import Path

from flask import Flask, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from src.config.config import DevelopmentConfig, ProductionConfig, TestingConfig
from src.database import db, init_db

# Add the src directory to the Python path for absolute imports
src_dir = Path(__file__).parent
sys.path.insert(0, str(src_dir.parent))


def create_app(config_name=None):
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # Configure the app based on environment
    if config_name is None:
        config_name = os.environ.get("FLASK_ENV", "development")

    if config_name == "production":
        app.config.from_object(ProductionConfig)
    elif config_name == "testing":
        app.config.from_object(TestingConfig)
    else:
        app.config.from_object(DevelopmentConfig)

    # Initialize extensions
    init_db(app)

    # Initialize CORS
    CORS(app, origins=app.config["CORS_ORIGINS"])

    # Initialize JWT
    jwt = JWTManager(app)

    # Register blueprints
    from src.api.ai import ai_bp
    from src.api.analytics import analytics_bp
    from src.api.auth import auth_bp
    from src.api.decks import decks_bp
    from src.api.flashcards import flashcards_bp
    from src.api.sync import sync_bp
    from src.api.users import users_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(users_bp, url_prefix="/api/users")
    app.register_blueprint(decks_bp, url_prefix="/api/decks")
    app.register_blueprint(flashcards_bp, url_prefix="/api/flashcards")
    app.register_blueprint(analytics_bp, url_prefix="/api/analytics")
    app.register_blueprint(sync_bp, url_prefix="/api/sync")
    app.register_blueprint(ai_bp, url_prefix="/api/ai")

    # Health check endpoint
    @app.route("/health")
    def health_check():
        """Comprehensive health check for Railway monitoring"""
        try:
            status = {"status": "healthy", "service": "cognition-curator-api"}
            checks = {}
            overall_healthy = True

            # Check database connectivity
            try:
                from sqlalchemy import text

                db.session.execute(text("SELECT 1"))
                checks["database"] = {
                    "status": "healthy",
                    "message": "Database connection successful",
                }
            except Exception as e:
                checks["database"] = {
                    "status": "unhealthy",
                    "message": f"Database error: {str(e)}",
                }
                overall_healthy = False

            # Check required environment variables
            required_env_vars = ["SECRET_KEY", "JWT_SECRET_KEY"]
            env_status = []
            for var in required_env_vars:
                if os.environ.get(var):
                    env_status.append(f"{var}: ✓")
                else:
                    env_status.append(f"{var}: ✗ MISSING")
                    overall_healthy = False

            checks["environment"] = {
                "status": "healthy" if overall_healthy else "unhealthy",
                "variables": env_status,
            }

            # Check Flask configuration
            checks["flask"] = {
                "status": "healthy",
                "debug": app.debug,
                "environment": os.environ.get("FLASK_ENV", "development"),
            }

            status["checks"] = checks
            status["timestamp"] = datetime.now().isoformat()

            if overall_healthy:
                return status, 200
            else:
                status["status"] = "unhealthy"
                return status, 503

        except Exception as e:
            return {
                "status": "unhealthy",
                "service": "cognition-curator-api",
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
            }, 500

    # Simple health check for Railway's built-in monitoring
    @app.route("/ping")
    def ping():
        """Simple ping endpoint for basic uptime monitoring"""
        return {"status": "ok", "message": "pong"}, 200

    # JWT error handlers
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return {"error": "Token has expired", "code": "token_expired"}, 401

    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return {"error": "Invalid token", "code": "invalid_token"}, 401

    @jwt.unauthorized_loader
    def missing_token_callback(error):
        return {
            "error": "Authorization token required",
            "code": "authorization_required",
        }, 401

    # Global error handlers for better logging
    @app.errorhandler(500)
    def internal_error(error):
        app.logger.error(f"Internal Server Error: {error}")
        app.logger.error(f"Error details: {str(error.original_exception)}")
        return {"error": "Internal server error", "code": "internal_error"}, 500

    @app.errorhandler(404)
    def not_found_error(error):
        app.logger.warning(f"404 Error: {request.url}")
        return {"error": "Resource not found", "code": "not_found"}, 404

    @app.errorhandler(Exception)
    def handle_exception(e):
        app.logger.error(f"Unhandled exception: {str(e)}")
        app.logger.error(f"Exception type: {type(e).__name__}")
        import traceback

        app.logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "error": "An unexpected error occurred",
            "code": "unexpected_error",
        }, 500

    return app


# Create the app instance for development
app = create_app()

if __name__ == "__main__":
    # Run the development server
    app.run(host="0.0.0.0", port=5001, debug=True)
