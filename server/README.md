# Cognition Curator API

Express + TypeScript backend. Replaces the Flask server (`server-legacy/`).

## Stack

- **Runtime**: Node.js / Express + TypeScript
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Stytch (magic links + Apple OAuth)
- **AI**: Anthropic Claude
- **Hosting**: Railway

## Local development

```bash
# 1. Start Postgres
docker-compose up -d

# 2. Copy env vars
cp .env.example .env
# Fill in STYTCH_PROJECT_ID, STYTCH_SECRET, ANTHROPIC_API_KEY

# 3. Install and run migrations
npm install
npx prisma migrate dev

# 4. Start dev server
npm run dev
```

Server starts at `http://localhost:8080`.

## Railway deployment

Railway root directory: `server/`

The service picks up `railway.json` automatically. Required env vars in the Railway service:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Provided automatically by Railway Postgres plugin |
| `STYTCH_PROJECT_ID` | Stytch project ID (`project-live-...`) |
| `STYTCH_SECRET` | Stytch secret (`secret-live-...`) |
| `STYTCH_ENV` | `live` for production, `test` for staging |
| `ANTHROPIC_API_KEY` | Claude API key |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `NODE_ENV` | `production` |

### First deploy on existing Railway Postgres

The `scripts/start.js` startup script detects whether `_prisma_migrations` table exists.
If it doesn't (existing Flask/Alembic DB), it marks the baseline migration as already applied,
then runs only the new migration (`add_stytch_user_id`).

No data loss — existing users, decks, flashcards, and review sessions are preserved.

## API routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /health` | — | Health check |
| `GET /ping` | — | Ping |
| `POST /api/auth/magic-link/send` | — | Send magic link |
| `POST /api/auth/oauth/apple/start` | — | Apple OAuth URL |
| `POST /api/auth/callback` | — | Exchange token → session JWT |
| `GET /api/auth/me` | ✓ | Profile |
| `PUT /api/auth/profile` | ✓ | Update profile |
| `POST /api/auth/logout` | ✓ | Revoke session |
| `GET /api/decks/` | ✓ | List decks |
| `POST /api/decks/` | ✓ | Create deck |
| `GET /api/decks/:id` | ✓ | Get deck |
| `PUT /api/decks/:id` | ✓ | Update deck |
| `DELETE /api/decks/:id` | ✓ | Soft-delete deck |
| `POST /api/flashcards/` | ✓ | Create flashcard |
| `POST /api/flashcards/batch` | ✓ | Batch create |
| `GET /api/flashcards/deck/:deckId` | ✓ | List by deck |
| `GET /api/flashcards/:id` | ✓ | Get flashcard |
| `PUT /api/flashcards/:id` | ✓ | Update flashcard |
| `DELETE /api/flashcards/:id` | ✓ | Soft-delete flashcard |
| `POST /api/sync/flashcard-review` | ✓ | Record review + update SM-2 state |
| `POST /api/sync/study-session` | ✓ | Record study session |
| `POST /api/sync/user-stats` | ✓ | Sync user stats |
| `GET /api/analytics/dashboard` | ✓ | Dashboard analytics |
| `POST /api/ai/generate-flashcards` | ✓ | AI card generation |
| `POST /api/ai/generate-answer` | ✓ | AI answer generation |

## Testing

```bash
npm test          # run all contract tests (no DB or network required)
npm run test:watch
```

## Migration notes

### Existing users (Flask / Apple Sign-In)
Existing rows in `users` have `stytch_user_id = NULL`. On first login via Stytch, the callback
endpoint matches by email and links the Stytch user ID to the existing row.

### Spaced repetition
SM-2 calculations remain client-authoritative (iOS app computes ease/interval/repetitions).
`POST /api/sync/flashcard-review` accepts the pre-computed values and persists them.
