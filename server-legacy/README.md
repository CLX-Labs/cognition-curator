# Cognition Curator Server

A robust Python Flask backend server for the Cognition Curator iOS app, featuring AI-powered flashcard generation, spaced repetition algorithms, and comprehensive user management.

## 🚀 Features

### Core Features
- **RESTful API** for iOS app integration
- **User Authentication & Authorization** with JWT tokens
- **Flashcard Management** with CRUD operations
- **Deck Organization** with superset deck support
- **Spaced Repetition** algorithms (SM-2, with extensibility for SM-18)
- **Progress Tracking** and analytics
- **Real-time Review Synchronization**

### AI-Powered Features
- **LangGraph Integration** for AI deck generation
- **OpenAI Integration** for content enhancement
- **Smart Question Generation** from text inputs
- **Difficulty Assessment** and adaptive learning

### Premium Features
- **CloudKit Sync** support
- **Advanced Analytics** and insights
- **Bulk Import/Export** functionality
- **Enhanced AI Features**

## 🏗️ Architecture

```
server/
├── src/                    # Source code
│   ├── api/               # API endpoints and blueprints
│   ├── models/            # SQLAlchemy database models
│   ├── services/          # Business logic and external integrations
│   ├── utils/             # Utility functions and helpers
│   └── config/            # Configuration management
├── tests/                 # Test suite
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── fixtures/          # Test fixtures and mock data
├── scripts/               # Development and deployment scripts
├── deploy/                # Deployment configurations
└── docs/                  # Documentation
```

## 📋 Prerequisites

- **Python 3.9+**
- **PostgreSQL 13+** (for production)
- **Redis 6+** (for caching and background tasks)
- **Docker & Docker Compose** (for containerized development)

### Optional but Recommended
- **Git** for version control
- **pre-commit** for code quality hooks
- **Railway CLI** for deployment

## 🛠️ Quick Start

### Option 1: Docker Development (Recommended)

1. **Clone and navigate to server directory:**
   ```bash
   cd server
   ```

2. **Start all services:**
   ```bash
   docker-compose up -d
   ```

3. **Access the application:**
   - **API Server**: http://localhost:5000
   - **PostgreSQL**: localhost:5432
   - **Redis**: localhost:6379
   - **PgAdmin**: http://localhost:5050 (admin@cognition-curator.com / admin)
   - **Flower (Celery Monitor)**: http://localhost:5555

### Option 2: Local Development

1. **Run the setup script:**
   ```bash
   chmod +x scripts/dev/setup.sh
   ./scripts/dev/setup.sh
   ```

2. **Activate virtual environment:**
   ```bash
   source venv/bin/activate
   ```

3. **Set up your environment:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start the development server:**
   ```bash
   ./scripts/dev/run.sh
   ```

## 🧪 Testing

The server includes a comprehensive testing suite with unit tests, integration tests, and various testing utilities.

### Running Tests

```bash
# Run all tests with coverage
./scripts/dev/test.sh

# Run only unit tests
./scripts/dev/test.sh -u

# Run only integration tests  
./scripts/dev/test.sh -i

# Run tests without coverage (faster)
./scripts/dev/test.sh -f

# Run tests in watch mode
./scripts/dev/test.sh -w

# Run all quality checks (tests + linting + type checking)
./scripts/dev/test.sh -A
```

### Test Categories

Tests are automatically marked based on their location and content:

- **Unit Tests** (`tests/unit/`): Fast, isolated tests
- **Integration Tests** (`tests/integration/`): Database and API tests
- **AI Tests** (`@pytest.mark.ai`): Tests requiring AI service access
- **Slow Tests** (`@pytest.mark.slow`): Long-running tests
- **External Tests** (`@pytest.mark.external`): Tests making external API calls

### Coverage Reports

Test coverage reports are generated in multiple formats:
- **Terminal output**: Immediate feedback
- **HTML report**: `htmlcov/index.html`
- **XML report**: `coverage.xml` (for CI/CD)

## 🗃️ Database

### Local Development

The setup script will help you configure PostgreSQL. For Docker development, the database is automatically configured.

### Database Management

```bash
# Create database migrations
flask db migrate -m "Description of changes"

# Apply migrations
flask db upgrade

# Downgrade migration
flask db downgrade
```

### Seeding Data

```bash
# Run database seeding script
python scripts/db/seed_data.py
```

## 🔧 Configuration

Configuration is managed through environment variables and configuration classes:

- **Development**: `DevelopmentConfig`
- **Testing**: `TestingConfig`  
- **Production**: `ProductionConfig`

### Key Environment Variables

```bash
# Flask Configuration
FLASK_ENV=development
SECRET_KEY=your-secret-key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/cognition_curator

# JWT Authentication
JWT_SECRET_KEY=your-jwt-secret
JWT_ACCESS_TOKEN_EXPIRES=86400

# AI Services
OPENAI_API_KEY=your-openai-key
LANGGRAPH_API_URL=your-langgraph-url
LANGGRAPH_API_KEY=your-langgraph-key

# Redis
REDIS_URL=redis://localhost:6379/0

# CORS
CORS_ORIGINS=cognitioncurator://,http://localhost:3000
```

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout

### Deck Management
- `GET /api/decks` - List user decks
- `POST /api/decks` - Create new deck
- `GET /api/decks/{id}` - Get deck details
- `PUT /api/decks/{id}` - Update deck
- `DELETE /api/decks/{id}` - Delete deck

### Flashcard Management
- `GET /api/decks/{deck_id}/cards` - List deck cards
- `POST /api/decks/{deck_id}/cards` - Create new card
- `GET /api/cards/{id}` - Get card details
- `PUT /api/cards/{id}` - Update card
- `DELETE /api/cards/{id}` - Delete card

### Review System
- `GET /api/review/due` - Get cards due for review
- `POST /api/review/session` - Submit review session
- `GET /api/review/stats` - Get review statistics

### AI Features
- `POST /api/ai/generate-deck` - AI deck generation
- `POST /api/ai/enhance-card` - AI card enhancement
- `POST /api/ai/suggest-difficulty` - AI difficulty suggestions

## 🎯 Code Quality

The project maintains high code quality through:

- **Type Hints**: Full type annotation with mypy checking
- **Code Formatting**: Black and isort for consistent style
- **Linting**: Flake8 for code quality checks
- **Security**: Bandit for security vulnerability scanning
- **Pre-commit Hooks**: Automated quality checks

### Running Quality Checks

```bash
# Run all quality checks
./scripts/dev/test.sh -A

# Run individual checks
./scripts/dev/test.sh -l  # Linting only
./scripts/dev/test.sh -t  # Type checking only
```

## 🚀 Deployment

### Railway Deployment

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and deploy:**
   ```bash
   railway login
   railway link
   railway up
   ```

### Docker Production

```bash
# Build production image
docker build --target production -t cognition-curator-server .

# Run production container
docker run -p 5000:5000 cognition-curator-server
```

## 🔍 Monitoring & Logging

### Application Monitoring
- **Structured Logging**: Using structlog for consistent log formatting
- **Error Tracking**: Sentry integration for error monitoring
- **Health Checks**: `/health` endpoint for service monitoring

### Background Task Monitoring
- **Flower**: Web-based Celery monitoring at http://localhost:5555
- **Redis Monitoring**: Built-in Redis monitoring commands

### Performance Monitoring
- **Database Query Monitoring**: SQLAlchemy query logging in development
- **API Response Time Tracking**: Built-in Flask request timing
- **Resource Usage**: Docker stats and system metrics

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Install development dependencies**: `./scripts/dev/setup.sh`
4. **Run tests**: `./scripts/dev/test.sh`
5. **Commit changes**: `git commit -m 'Add amazing feature'`
6. **Push to branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Workflow

1. **Write tests first** (TDD approach)
2. **Implement feature** with proper type hints
3. **Run quality checks**: `./scripts/dev/test.sh -A`
4. **Update documentation** if needed
5. **Submit PR** with clear description

## 📖 Additional Documentation

- **API Reference**: `/docs/api.md`
- **Database Schema**: `/docs/database.md`
- **Deployment Guide**: `/docs/deployment.md`
- **Contributing Guide**: `/docs/contributing.md`

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

## 🆘 Support

- **Issues**: Create an issue on GitHub
- **Documentation**: Check the `/docs` directory
- **Discord**: Join our development Discord server

---

Built with ❤️ by the Cognition Curator Team 