import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateSchema } from '../middleware/validateSchema';
import { magicLinkSendSchema, callbackSchema, updateProfileSchema } from '../schemas/auth.schema';
import * as AuthController from '../controllers/auth.controller';

const router = Router();

router.post('/magic-link/send', validateSchema(magicLinkSendSchema), AuthController.sendMagicLink);
router.post('/oauth/apple/start', AuthController.getAppleOAuthStartUrl);
router.post('/callback', validateSchema(callbackSchema), AuthController.callback);
router.get('/me', requireAuth, AuthController.me);
router.put('/profile', requireAuth, validateSchema(updateProfileSchema), AuthController.updateProfile);
router.post('/logout', requireAuth, AuthController.logout);

export { router as authRouter };
