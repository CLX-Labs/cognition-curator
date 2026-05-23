#!/bin/bash

# Cognition Curator Flask Server Runner
# This script sets up the environment and runs the Flask development server

set -e

# Activate virtual environment
source venv/bin/activate

# Set environment variables
export DATABASE_URL="postgresql://dean@localhost/cognition_curator_dev"
export FLASK_APP="src/app.py"
export FLASK_ENV="development"
export FLASK_DEBUG="1"

echo "🚀 Starting Cognition Curator Flask Server..."
echo "📊 Database: $DATABASE_URL"
echo "🌐 Server will be available at: http://localhost:5001"
echo ""

# Run Flask development server
flask run --host=0.0.0.0 --port=5001
