import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiEnv = path.join(root, '.env');
if (!fs.existsSync(apiEnv)) {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  fs.writeFileSync(
    apiEnv,
    example.replace(
      /^ACCESS_TOKEN_SECRET=$/m,
      `ACCESS_TOKEN_SECRET=${randomBytes(48).toString('base64url')}`,
    ),
    { mode: 0o600 },
  );
  console.log('Created the local API configuration with a random signing secret.');
} else console.log('Kept the existing API configuration.');
const mobileEnv = path.join(root, 'apps/mobile/.env');
if (!fs.existsSync(mobileEnv)) {
  fs.writeFileSync(
    mobileEnv,
    'EXPO_PUBLIC_API_URL=http://127.0.0.1:3001\nEXPO_PUBLIC_ENABLE_DEV_AUTH=false\n',
    { mode: 0o600 },
  );
  console.log(
    'Created local mobile configuration. Use your computer LAN address for a physical device.',
  );
} else console.log('Kept the existing mobile configuration.');
console.log(
  'Next: docker compose up -d; CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate; npm run dev:api.',
);
console.log(
  'Set the Anthropic key/model before starting the worker. Native features require a development build.',
);
