#!/bin/bash

# Cognition Curator Server - Development Setup Script
# This script sets up the development environment for the Flask server

set -e  # Exit on any error

echo "🚀 Setting up Cognition Curator Server Development Environment"

# Check if Python 3.9+ is installed
python_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
required_version="3.9"

if ! python3 -c "import sys; exit(0 if sys.version_info >= (3, 9) else 1)"; then
    echo "❌ Python 3.9+ is required. Found Python $python_version"
    echo "Please install Python 3.9 or higher"
    exit 1
fi

echo "✅ Python $python_version detected"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📚 Installing dependencies..."
pip install -r requirements-dev.txt

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs
mkdir -p uploads
mkdir -p instance

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "⚙️ Creating .env file from template..."
    cp env.example .env
    echo "✅ .env file created. Please update it with your configuration."
else
    echo "✅ .env file already exists"
fi

# Install pre-commit hooks
echo "🔒 Installing pre-commit hooks..."
pre-commit install

# Check if PostgreSQL is running (optional check)
if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -q; then
        echo "✅ PostgreSQL is running"
    else
        echo "⚠️ PostgreSQL is not running. You may need to start it:"
        echo "   brew services start postgresql  # macOS with Homebrew"
        echo "   sudo systemctl start postgresql  # Linux with systemd"
    fi
else
    echo "⚠️ PostgreSQL not detected. Install it if you plan to use a local database."
fi

# Check if Redis is running (optional check)
if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli ping >/dev/null 2>&1; then
        echo "✅ Redis is running"
    else
        echo "⚠️ Redis is not running. You may need to start it:"
        echo "   brew services start redis  # macOS with Homebrew"
        echo "   sudo systemctl start redis  # Linux with systemd"
    fi
else
    echo "⚠️ Redis not detected. Install it if you plan to use caching/background tasks."
fi

# Run initial tests to verify setup
echo "🧪 Running initial tests..."
if pytest tests/unit/test_config.py -v; then
    echo "✅ Initial tests passed"
else
    echo "❌ Some tests failed. Please check the setup."
fi

echo ""
echo "🎉 Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Update the .env file with your configuration"
echo "2. Set up your database (see scripts/db/setup_database.sh)"
echo "3. Run the development server: ./scripts/dev/run.sh"
echo "4. Run tests: ./scripts/dev/test.sh"
echo ""
echo "Useful commands:"
echo "  source venv/bin/activate  # Activate virtual environment"
echo "  deactivate                # Deactivate virtual environment"
echo "  pytest                    # Run all tests"
echo "  pytest -m unit            # Run only unit tests"
echo "  pytest -m integration     # Run only integration tests"
