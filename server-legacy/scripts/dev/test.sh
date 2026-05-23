#!/bin/bash

# Cognition Curator Server - Test Runner Script
# This script provides various testing options for the Flask server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_colored() {
    printf "${1}${2}${NC}\n"
}

# Function to show usage
show_usage() {
    print_colored $BLUE "Cognition Curator Server - Test Runner"
    echo ""
    echo "Usage: $0 [OPTIONS] [TEST_ARGS]"
    echo ""
    echo "Options:"
    echo "  -u, --unit         Run only unit tests"
    echo "  -i, --integration  Run only integration tests"
    echo "  -c, --coverage     Run tests with coverage report"
    echo "  -f, --fast         Run tests without coverage (faster)"
    echo "  -w, --watch        Run tests in watch mode"
    echo "  -s, --slow         Include slow tests"
    echo "  -a, --ai           Include AI-dependent tests"
    echo "  -e, --external     Include external API tests"
    echo "  -v, --verbose      Verbose output"
    echo "  -q, --quiet        Quiet output"
    echo "  -x, --exitfirst    Stop on first failure"
    echo "  -l, --linting      Run linting checks"
    echo "  -t, --type-check   Run type checking"
    echo "  -A, --all          Run all checks (tests, linting, type checking)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Run all tests with coverage"
    echo "  $0 -u                 # Run only unit tests"
    echo "  $0 -c -v              # Run tests with coverage and verbose output"
    echo "  $0 -f tests/unit/     # Run unit tests quickly without coverage"
    echo "  $0 -w -u              # Watch unit tests"
    echo "  $0 -A                 # Run all checks"
}

# Default options
RUN_UNIT=false
RUN_INTEGRATION=false
RUN_COVERAGE=true
WATCH_MODE=false
INCLUDE_SLOW=false
INCLUDE_AI=false
INCLUDE_EXTERNAL=false
VERBOSE=false
QUIET=false
EXIT_FIRST=false
RUN_LINTING=false
RUN_TYPE_CHECK=false
FAST_MODE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--unit)
            RUN_UNIT=true
            shift
            ;;
        -i|--integration)
            RUN_INTEGRATION=true
            shift
            ;;
        -c|--coverage)
            RUN_COVERAGE=true
            shift
            ;;
        -f|--fast)
            FAST_MODE=true
            RUN_COVERAGE=false
            shift
            ;;
        -w|--watch)
            WATCH_MODE=true
            shift
            ;;
        -s|--slow)
            INCLUDE_SLOW=true
            shift
            ;;
        -a|--ai)
            INCLUDE_AI=true
            shift
            ;;
        -e|--external)
            INCLUDE_EXTERNAL=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -q|--quiet)
            QUIET=true
            shift
            ;;
        -x|--exitfirst)
            EXIT_FIRST=true
            shift
            ;;
        -l|--linting)
            RUN_LINTING=true
            shift
            ;;
        -t|--type-check)
            RUN_TYPE_CHECK=true
            shift
            ;;
        -A|--all)
            RUN_LINTING=true
            RUN_TYPE_CHECK=true
            RUN_COVERAGE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            # Pass remaining arguments to pytest
            break
            ;;
    esac
done

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Build pytest command
PYTEST_CMD="pytest"

# Add coverage if requested and not in fast mode
if [ "$RUN_COVERAGE" = true ] && [ "$FAST_MODE" = false ]; then
    PYTEST_CMD="$PYTEST_CMD --cov=src --cov-report=term-missing --cov-report=html"
fi

# Add verbosity
if [ "$VERBOSE" = true ]; then
    PYTEST_CMD="$PYTEST_CMD -v"
elif [ "$QUIET" = true ]; then
    PYTEST_CMD="$PYTEST_CMD -q"
fi

# Add exit on first failure
if [ "$EXIT_FIRST" = true ]; then
    PYTEST_CMD="$PYTEST_CMD -x"
fi

# Add test markers
MARKERS=""

if [ "$RUN_UNIT" = true ] && [ "$RUN_INTEGRATION" = false ]; then
    MARKERS="unit"
elif [ "$RUN_INTEGRATION" = true ] && [ "$RUN_UNIT" = false ]; then
    MARKERS="integration"
fi

if [ "$INCLUDE_SLOW" = false ]; then
    if [ -n "$MARKERS" ]; then
        MARKERS="$MARKERS and not slow"
    else
        MARKERS="not slow"
    fi
fi

if [ "$INCLUDE_AI" = false ]; then
    if [ -n "$MARKERS" ]; then
        MARKERS="$MARKERS and not ai"
    else
        MARKERS="not ai"
    fi
fi

if [ "$INCLUDE_EXTERNAL" = false ]; then
    if [ -n "$MARKERS" ]; then
        MARKERS="$MARKERS and not external"
    else
        MARKERS="not external"
    fi
fi

if [ -n "$MARKERS" ]; then
    PYTEST_CMD="$PYTEST_CMD -m \"$MARKERS\""
fi

# Add any remaining arguments
if [ $# -gt 0 ]; then
    PYTEST_CMD="$PYTEST_CMD $*"
fi

# Function to run linting
run_linting() {
    print_colored $BLUE "Running linting checks..."

    print_colored $YELLOW "Running flake8..."
    flake8 src tests

    print_colored $YELLOW "Running black (check only)..."
    black --check src tests

    print_colored $YELLOW "Running isort (check only)..."
    isort --check-only src tests

    print_colored $YELLOW "Running bandit security checks..."
    bandit -r src

    print_colored $GREEN "✅ Linting checks passed!"
}

# Function to run type checking
run_type_check() {
    print_colored $BLUE "Running type checking..."

    print_colored $YELLOW "Running mypy..."
    mypy src

    print_colored $GREEN "✅ Type checking passed!"
}

# Function to run tests
run_tests() {
    print_colored $BLUE "Running tests..."
    print_colored $YELLOW "Command: $PYTEST_CMD"

    if [ "$WATCH_MODE" = true ]; then
        print_colored $BLUE "Running in watch mode (press Ctrl+C to stop)..."
        ptw -- $PYTEST_CMD
    else
        eval $PYTEST_CMD
    fi
}

# Main execution
print_colored $BLUE "🧪 Cognition Curator Server Test Runner"

# Run linting if requested
if [ "$RUN_LINTING" = true ]; then
    run_linting
fi

# Run type checking if requested
if [ "$RUN_TYPE_CHECK" = true ]; then
    run_type_check
fi

# Run tests
run_tests

# Show coverage report location if coverage was generated
if [ "$RUN_COVERAGE" = true ] && [ "$FAST_MODE" = false ]; then
    echo ""
    print_colored $GREEN "📊 Coverage report generated:"
    print_colored $YELLOW "  HTML: htmlcov/index.html"
    print_colored $YELLOW "  Terminal: See above"
fi

print_colored $GREEN "✅ All checks completed successfully!"
