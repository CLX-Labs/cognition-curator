import * as stytch from 'stytch';
import { env } from '../config/env';

export const stytchClient = new stytch.Client({
  project_id: env.STYTCH_PROJECT_ID,
  secret: env.STYTCH_SECRET,
});
