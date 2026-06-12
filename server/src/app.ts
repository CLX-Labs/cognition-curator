import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authRouter } from './routes/auth';
import { decksRouter } from './routes/decks';
import { flashcardsRouter } from './routes/flashcards';
import { syncRouter } from './routes/sync';
import { analyticsRouter } from './routes/analytics';
import { aiRouter } from './routes/ai';
import { errorHandler, notFound } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = express();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile clients, curl, etc.)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Health check (Railway probes this)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: env.NODE_ENV });
});

app.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/decks', decksRouter);
app.use('/api/flashcards', flashcardsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/ai', aiRouter);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(env.PORT, () => {
    logger.info(`Cognition Curator API running on port ${env.PORT}`, { env: env.NODE_ENV });
  });
}

export default app;
