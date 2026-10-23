import { createDatabase } from '../packages/db/src/index.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { processAccountDeletions } from '../apps/api/src/account-deletion.ts';

if (process.env.CONFIRM_ACCOUNT_DELETION_PROCESSING !== 'yes') {
  throw new Error(
    'Review DATABASE_URL and set CONFIRM_ACCOUNT_DELETION_PROCESSING=yes. Only previously confirmed deletion requests are processed.',
  );
}
const config = loadConfig();
const db = createDatabase(config.databaseUrl);
try {
  console.log(JSON.stringify(await processAccountDeletions(db, config, { limit: 20 })));
} finally {
  await db.end();
}
