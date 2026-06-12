import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as AnalyticsController from '../controllers/analytics.controller';

const router = Router();

router.use(requireAuth);

router.get('/dashboard', AnalyticsController.dashboard);

export { router as analyticsRouter };
