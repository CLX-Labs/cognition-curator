import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import {
  accountDeletionReceiptSchema,
  type AccountDeletionReceipt,
  type AccountDeletionRequest,
} from '@recollect/contracts';
import {
  DomainError,
  lockOwner,
  secretHash,
  transaction,
  type Database,
  type Transaction,
} from '@recollect/db';
import type { AppleClaims } from './auth.js';
import type { ApiConfig } from './config.js';

type DeletionRow = {
  id: string;
  owner_id: string;
  operation_id: string;
  apple_subject_hash: string;
  status: 'pending' | 'completed';
  requested_at: Date;
  completed_at: Date | null;
  estimated_completion_days: number | null;
  apple_token_ciphertext: string | null;
  apple_token_kind: 'authorization_code' | 'refresh_token' | null;
  apple_code_created_at: Date | null;
  apple_revoked_at: Date | null;
  error_code: string | null;
  token_timestamp?: string | null;
  revocation_timestamp?: string | null;
};
function key(config: ApiConfig) {
  return createHash('sha256')
    .update('recollect.account-deletion.v1\0' + config.accessSecret)
    .digest();
}
function encrypt(value: string, config: ApiConfig) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(config), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}
function decrypt(value: string, config: ApiConfig) {
  const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('invalid_ciphertext');
  const cipher = createDecipheriv('aes-256-gcm', key(config), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function receipt(row: DeletionRow): AccountDeletionReceipt {
  const reauthenticate = [
    'apple_authorization_expired',
    'apple_authorization_required',
    'apple_authorization_mismatch',
    'apple_refresh_token_rejected',
    'apple_credential_unreadable',
  ].includes(row.error_code ?? '');
  return accountDeletionReceiptSchema.parse({
    requestId: row.id,
    ownerId: row.owner_id,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    estimatedCompletionDays: row.estimated_completion_days,
    actionRequired:
      row.status === 'completed'
        ? 'none'
        : reauthenticate
          ? 'reauthenticate'
          : [
                'apple_revocation_not_configured',
                'legacy_schema_review_required',
                'legacy_identity_review_required',
                'deletion_processing_failed',
              ].includes(row.error_code ?? '')
            ? 'contact_support'
            : 'none',
  });
}
export function appleRevocationConfigured(config: ApiConfig) {
  return Boolean(
    config.appleSignInTeamId && config.appleSignInKeyId && config.appleSignInPrivateKey,
  );
}

export class AccountDeletionService {
  constructor(
    private db: Database,
    private config: ApiConfig,
  ) {}

  async request(
    input: AccountDeletionRequest,
    claims: AppleClaims,
  ): Promise<AccountDeletionReceipt> {
    return transaction(this.db, async (tx) => {
      const subjectHash = secretHash(claims.sub);
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'recollect.apple:' + subjectHash,
      ]);
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'recollect.account:' + input.ownerId,
      ]);
      const challenge = (
        await tx.query<{ nonce_hash: string; expires_at: Date; consumed_at: Date | null }>(
          'SELECT * FROM recollect.auth_challenges WHERE id=$1 FOR UPDATE',
          [input.challengeId],
        )
      ).rows[0];
      if (
        !challenge ||
        challenge.expires_at.getTime() <= Date.now() ||
        claims.nonce !== challenge.nonce_hash
      )
        throw new DomainError(
          'invalid_challenge',
          'Confirm your Apple sign-in again before deleting this account.',
          401,
        );
      const existing = (
        await tx.query<DeletionRow>(
          'SELECT * FROM recollect.account_deletion_requests WHERE owner_id=$1 FOR UPDATE',
          [input.ownerId],
        )
      ).rows[0];
      if (existing) {
        if (existing.apple_subject_hash !== subjectHash)
          throw new DomainError(
            'account_mismatch',
            'Confirm the Apple account used for this Recollect account.',
            403,
          );
        if (
          existing.status === 'pending' &&
          !challenge.consumed_at &&
          input.authorizationCode &&
          existing.apple_token_kind !== 'refresh_token' &&
          !existing.apple_revoked_at
        ) {
          await tx.query('UPDATE recollect.auth_challenges SET consumed_at=now() WHERE id=$1', [
            input.challengeId,
          ]);
          const updated = (
            await tx.query<DeletionRow>(
              `UPDATE recollect.account_deletion_requests SET apple_token_ciphertext=$2,apple_token_kind='authorization_code',apple_code_created_at=now(),
             error_code=$3 WHERE id=$1 RETURNING *`,
              [
                existing.id,
                encrypt(input.authorizationCode, this.config),
                appleRevocationConfigured(this.config) ? null : 'apple_revocation_not_configured',
              ],
            )
          ).rows[0]!;
          return receipt(updated);
        }
        return receipt(existing);
      }
      if (challenge.consumed_at)
        throw new DomainError(
          'invalid_challenge',
          'Confirm your Apple sign-in again before deleting this account.',
          401,
        );
      const user = (
        await tx.query<{ apple_id: string | null; is_active: boolean }>(
          'SELECT apple_id,is_active FROM recollect.users WHERE id=$1 FOR UPDATE',
          [input.ownerId],
        )
      ).rows[0];
      if (!user || user.apple_id !== claims.sub || !user.is_active)
        throw new DomainError(
          'account_mismatch',
          'Confirm the Apple account used for this Recollect account.',
          403,
        );
      await lockOwner(tx, input.ownerId);
      const collision = await tx.query(
        'SELECT 1 FROM recollect.account_deletion_requests WHERE id=$1',
        [input.operationId],
      );
      if (collision.rowCount)
        throw new DomainError('operation_id_reused', 'Use a new deletion request identifier.', 409);
      await tx.query('UPDATE recollect.auth_challenges SET consumed_at=now() WHERE id=$1', [
        input.challengeId,
      ]);
      const row = (
        await tx.query<DeletionRow>(
          `INSERT INTO recollect.account_deletion_requests(id,owner_id,operation_id,apple_subject_hash,estimated_completion_days,
         apple_token_ciphertext,apple_token_kind,apple_code_created_at,error_code) VALUES($1,$2,$1,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            input.operationId,
            input.ownerId,
            subjectHash,
            this.config.accountDeletionMaxDays ?? null,
            input.authorizationCode ? encrypt(input.authorizationCode, this.config) : null,
            input.authorizationCode ? 'authorization_code' : null,
            input.authorizationCode ? new Date() : null,
            !appleRevocationConfigured(this.config)
              ? 'apple_revocation_not_configured'
              : input.authorizationCode
                ? null
                : 'apple_authorization_required',
          ],
        )
      ).rows[0]!;
      await tx.query('UPDATE recollect.users SET is_active=false WHERE id=$1', [input.ownerId]);
      await tx.query('UPDATE recollect.session_families SET revoked_at=now() WHERE owner_id=$1', [
        input.ownerId,
      ]);
      await tx.query('UPDATE recollect.sessions SET revoked_at=now() WHERE owner_id=$1', [
        input.ownerId,
      ]);
      await tx.query(
        `UPDATE recollect.generation_jobs SET status='canceled',fence=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=$1 AND status IN ('queued','running')`,
        [input.ownerId],
      );
      return receipt(row);
    });
  }
}

export interface AppleDeletionClient {
  exchange(code: string, expectedSubjectHash: string): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
}
export class AppleDeletionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
function appleClient(config: ApiConfig): AppleDeletionClient {
  async function post(path: string, parameters: Record<string, string>) {
    const now = Math.floor(Date.now() / 1000);
    const signingKey = await importPKCS8(
      config.appleSignInPrivateKey!.replace(/\\n/g, '\n'),
      'ES256',
    );
    const clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.appleSignInKeyId! })
      .setIssuer(config.appleSignInTeamId!)
      .setSubject(config.appleAudience)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(signingKey);
    const response = await fetch('https://appleid.apple.com/auth/' + path, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.appleAudience,
        client_secret: clientSecret,
        ...parameters,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      refresh_token?: string;
      id_token?: string;
    };
    if (!response.ok) {
      const rejected = data.error === 'invalid_grant' || data.error === 'invalid_token';
      throw new AppleDeletionError(
        rejected
          ? path === 'token'
            ? 'apple_authorization_expired'
            : 'apple_refresh_token_rejected'
          : 'apple_revocation_failed',
      );
    }
    return data;
  }
  return {
    async exchange(code, expectedSubjectHash) {
      const result = await post('token', { grant_type: 'authorization_code', code });
      if (!result.refresh_token || !result.id_token)
        throw new AppleDeletionError('apple_authorization_required');
      try {
        const { payload } = await jwtVerify(result.id_token, appleKeys, {
          issuer: 'https://appleid.apple.com',
          audience: config.appleAudience,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp', 'iat'],
        });
        if (typeof payload.sub !== 'string' || secretHash(payload.sub) !== expectedSubjectHash)
          throw new Error('mismatch');
      } catch {
        throw new AppleDeletionError('apple_authorization_mismatch');
      }
      return result.refresh_token;
    },
    async revoke(token) {
      await post('revoke', { token, token_type_hint: 'refresh_token' });
    },
  };
}

const legacyTables = [
  'users',
  'decks',
  'flashcards',
  'review_sessions',
  'study_sessions',
  'retention_data',
  'performance_metrics',
  'learning_insights',
] as const;
async function purgeLegacy(tx: Transaction, owner: string, subjectHash: string) {
  const columns = (
    await tx.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])`,
      [legacyTables],
    )
  ).rows;
  const schema = new Map<string, Set<string>>();
  for (const column of columns) {
    if (!schema.has(column.table_name)) schema.set(column.table_name, new Set());
    schema.get(column.table_name)!.add(column.column_name);
  }
  if (!schema.has('users')) return;
  const unknownOwned = await tx.query<{ table_name: string; column_name: string }>(
    `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
     AND column_name IN ('owner_id','user_id') AND NOT(table_name=ANY($1::text[]))`,
    [legacyTables],
  );
  for (const row of unknownOwned.rows) {
    // Catalog identifiers are quoted, never interpreted as SQL supplied by a user.
    const table = '"' + row.table_name.replaceAll('"', '""') + '"';
    const owned = await tx.query(
      `SELECT 1 FROM public.${table} WHERE "${row.column_name}"::text=$1 LIMIT 1`,
      [owner],
    );
    if (owned.rowCount) throw new AppleDeletionError('legacy_schema_review_required');
  }
  const required: Record<string, string[]> = {
    users: ['id', 'apple_id'],
    decks: ['id', 'user_id'],
    flashcards: ['id', 'deck_id'],
    review_sessions: ['user_id', 'deck_id', 'flashcard_id'],
    study_sessions: ['user_id', 'deck_id'],
    retention_data: ['user_id', 'flashcard_id'],
    performance_metrics: ['user_id'],
    learning_insights: ['user_id'],
  };
  for (const [table, names] of Object.entries(required))
    if (schema.has(table) && names.some((name) => !schema.get(table)!.has(name)))
      throw new AppleDeletionError('legacy_schema_review_required');
  const differentLegacyIdentity = await tx.query(
    'SELECT 1 FROM public.users WHERE apple_id=(SELECT apple_id FROM recollect.users WHERE id=$1) AND id<>$1 LIMIT 1',
    [owner],
  );
  if (differentLegacyIdentity.rowCount)
    throw new AppleDeletionError('legacy_identity_review_required');
  const legacy = (
    await tx.query<{ apple_id: string | null }>(
      'SELECT apple_id FROM public.users WHERE id=$1 FOR UPDATE',
      [owner],
    )
  ).rows[0];
  if (!legacy) return;
  if (!legacy.apple_id || secretHash(legacy.apple_id) !== subjectHash)
    throw new AppleDeletionError('legacy_identity_review_required');
  const references = (
    await tx.query<{ source_schema: string; source_table: string }>(
      `SELECT ns.nspname AS source_schema,c.relname AS source_table FROM pg_constraint fk
     JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
     JOIN pg_class target ON target.oid=fk.confrelid JOIN pg_namespace tn ON tn.oid=target.relnamespace
     WHERE fk.contype='f' AND tn.nspname='public' AND target.relname=ANY($1::text[])`,
      [legacyTables],
    )
  ).rows;
  if (references.some((row) => row.source_schema !== 'public' || !schema.has(row.source_table)))
    throw new AppleDeletionError('legacy_schema_review_required');
  const deckIds = schema.has('decks')
    ? (
        await tx.query<{ id: string }>('SELECT id FROM public.decks WHERE user_id=$1', [owner])
      ).rows.map((row) => row.id)
    : [];
  const cardIds = schema.has('flashcards')
    ? (
        await tx.query<{ id: string }>(
          'SELECT id FROM public.flashcards WHERE deck_id=ANY($1::uuid[])',
          [deckIds],
        )
      ).rows.map((row) => row.id)
    : [];
  for (const table of ['review_sessions', 'study_sessions', 'retention_data']) {
    if (!schema.has(table)) continue;
    const values: unknown[] = [owner];
    const deckCheck = schema.get(table)!.has('deck_id')
      ? `deck_id=ANY($${values.push(deckIds)}::uuid[])`
      : 'false';
    const cardCheck = schema.get(table)!.has('flashcard_id')
      ? `flashcard_id=ANY($${values.push(cardIds)}::uuid[])`
      : 'false';
    const crossed = await tx.query(
      `SELECT 1 FROM public.${table} WHERE user_id IS DISTINCT FROM $1::uuid AND (${deckCheck} OR ${cardCheck}) LIMIT 1`,
      values,
    );
    if (crossed.rowCount) throw new AppleDeletionError('legacy_schema_review_required');
  }
  for (const table of [
    'review_sessions',
    'study_sessions',
    'retention_data',
    'performance_metrics',
    'learning_insights',
  ])
    if (schema.has(table)) await tx.query(`DELETE FROM public.${table} WHERE user_id=$1`, [owner]);
  if (schema.has('flashcards'))
    await tx.query('DELETE FROM public.flashcards WHERE deck_id=ANY($1::uuid[])', [deckIds]);
  if (schema.has('decks')) await tx.query('DELETE FROM public.decks WHERE user_id=$1', [owner]);
  await tx.query('DELETE FROM public.users WHERE id=$1', [owner]);
}

async function purgeAccount(db: Database, request: DeletionRow) {
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'recollect.apple:' + request.apple_subject_hash,
    ]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'recollect.account:' + request.owner_id,
    ]);
    const user = (
      await tx.query<{ is_active: boolean }>(
        'SELECT is_active FROM recollect.users WHERE id=$1 FOR UPDATE',
        [request.owner_id],
      )
    ).rows[0];
    if (user?.is_active) throw new Error('active_account_cannot_be_purged');
    if (user) await lockOwner(tx, request.owner_id, { allowInactive: true });
    await purgeLegacy(tx, request.owner_id, request.apple_subject_hash);
    const safety = await tx.query<{ reports: string | null; blocks: string | null }>(
      `SELECT to_regclass('recollect.content_reports')::text AS reports,to_regclass('recollect.user_blocks')::text AS blocks`,
    );
    if (safety.rows[0]?.reports)
      await tx.query(
        'DELETE FROM recollect.content_reports WHERE reporter_id=$1 OR target_user_id=$1',
        [request.owner_id],
      );
    if (safety.rows[0]?.blocks)
      await tx.query('DELETE FROM recollect.user_blocks WHERE blocker_id=$1 OR blocked_id=$1', [
        request.owner_id,
      ]);
    // Marketplace provenance is removable without touching independently owned
    // downloaded decks/cards. Cascades remove snapshots, mappings and receipts.
    if (
      (await tx.query("SELECT to_regclass('recollect.marketplace_listings') AS name")).rows[0]?.name
    ) {
      await tx.query(
        'DELETE FROM recollect.marketplace_reports WHERE reporter_id=$1 OR target_user_id=$1',
        [request.owner_id],
      );
      await tx.query('DELETE FROM recollect.marketplace_downloads WHERE recipient_id=$1', [
        request.owner_id,
      ]);
      await tx.query('DELETE FROM recollect.marketplace_listings WHERE owner_id=$1', [
        request.owner_id,
      ]);
    }
    await tx.query('DELETE FROM recollect.deck_shares WHERE sender_id=$1 OR recipient_id=$1', [
      request.owner_id,
    ]);
    await tx.query('DELETE FROM recollect.friendships WHERE user_a=$1 OR user_b=$1', [
      request.owner_id,
    ]);
    await tx.query('DELETE FROM recollect.friend_invites WHERE owner_id=$1 OR consumed_by=$1', [
      request.owner_id,
    ]);
    for (const table of [
      'generation_jobs',
      'acceptance_receipts',
      'quota_buckets',
      'review_events',
      'cards',
      'decks',
      'changes',
      'operation_receipts',
      'legacy_archives',
      'import_batches',
      'sessions',
      'session_families',
      'sync_heads',
    ])
      await tx.query(`DELETE FROM recollect.${table} WHERE owner_id=$1`, [request.owner_id]);
    await tx.query('DELETE FROM recollect.rate_buckets WHERE scope LIKE $1', [
      'community:%:' + request.owner_id,
    ]);
    await tx.query('DELETE FROM recollect.rate_buckets WHERE scope LIKE $1', [
      'marketplace:%:' + request.owner_id,
    ]);
    await tx.query('DELETE FROM recollect.users WHERE id=$1', [request.owner_id]);
    await tx.query(
      `UPDATE recollect.account_deletion_requests SET status='completed',completed_at=now(),apple_token_ciphertext=NULL,apple_token_kind=NULL,apple_code_created_at=NULL,error_code=NULL WHERE id=$1`,
      [request.id],
    );
  });
}

const materialProjection =
  '*,apple_code_created_at::text AS token_timestamp,apple_revoked_at::text AS revocation_timestamp';
type CredentialMaterial = {
  ciphertext: string | null;
  kind: DeletionRow['apple_token_kind'];
  codeTimestamp: string | null;
  revokedTimestamp: string | null;
};
function credentialMaterial(row: DeletionRow): CredentialMaterial {
  return {
    ciphertext: row.apple_token_ciphertext,
    kind: row.apple_token_kind,
    // PostgreSQL has microsecond precision; Date alone loses precision and
    // cannot be used as an exact compare-and-set version for SQL now().
    codeTimestamp: row.token_timestamp ?? row.apple_code_created_at?.toISOString() ?? null,
    revokedTimestamp: row.revocation_timestamp ?? row.apple_revoked_at?.toISOString() ?? null,
  };
}
async function replaceCredentialMaterial(
  db: Database,
  previous: DeletionRow,
  next: CredentialMaterial,
  error: string | null,
): Promise<DeletionRow | null> {
  const before = credentialMaterial(previous);
  const result = await db.query<DeletionRow>(
    `UPDATE recollect.account_deletion_requests SET apple_token_ciphertext=$2,apple_token_kind=$3,
     apple_code_created_at=$4::timestamptz,apple_revoked_at=$5::timestamptz,error_code=$6
     WHERE id=$1 AND status='pending'
     AND apple_token_ciphertext IS NOT DISTINCT FROM $7::text
     AND apple_token_kind IS NOT DISTINCT FROM $8::text
     AND apple_code_created_at IS NOT DISTINCT FROM $9::timestamptz
     AND apple_revoked_at IS NOT DISTINCT FROM $10::timestamptz RETURNING ${materialProjection}`,
    [
      previous.id,
      next.ciphertext,
      next.kind,
      next.codeTimestamp,
      next.revokedTimestamp,
      error,
      before.ciphertext,
      before.kind,
      before.codeTimestamp,
      before.revokedTimestamp,
    ],
  );
  return result.rows[0] ?? null;
}

/** Runs only previously confirmed requests; it never initiates deletion. */
export async function processAccountDeletions(
  db: Database,
  config: ApiConfig,
  options: { apple?: AppleDeletionClient; limit?: number } = {},
) {
  const mutex = await db.connect();
  const totals = { completed: 0, pending: 0 };
  let held = false;
  try {
    held = (
      await mutex.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('recollect.account-deletion.processor')) AS locked",
      )
    ).rows[0]!.locked;
    if (!held) return totals;
    const pending = (
      await db.query<DeletionRow>(
        `SELECT ${materialProjection} FROM recollect.account_deletion_requests WHERE status='pending' ORDER BY last_attempt_at ASC NULLS FIRST,requested_at LIMIT $1`,
        [Math.min(20, Math.max(1, options.limit ?? 5))],
      )
    ).rows;
    for (const request of pending) {
      let current = request;
      try {
        await db.query(
          'UPDATE recollect.account_deletion_requests SET attempts=attempts+1,last_attempt_at=now() WHERE id=$1',
          [request.id],
        );
        if (!request.apple_revoked_at) {
          if (
            request.apple_token_kind === 'authorization_code' &&
            (!request.apple_code_created_at ||
              Date.now() - request.apple_code_created_at.getTime() >= 240_000)
          ) {
            await replaceCredentialMaterial(
              db,
              current,
              { ...credentialMaterial(current), ciphertext: null, kind: null, codeTimestamp: null },
              'apple_authorization_expired',
            );
            totals.pending++;
            continue;
          }
          if (!options.apple && !appleRevocationConfigured(config))
            throw new AppleDeletionError('apple_revocation_not_configured');
          const apple = options.apple ?? appleClient(config);
          if (!request.apple_token_ciphertext)
            throw new AppleDeletionError('apple_authorization_required');
          let token: string;
          try {
            token = decrypt(request.apple_token_ciphertext, config);
          } catch {
            // A key rotation/corrupt ciphertext must remain recoverable through
            // fresh same-owner Apple proof, without erasing a newer retry.
            await replaceCredentialMaterial(
              db,
              current,
              { ...credentialMaterial(current), ciphertext: null, kind: null, codeTimestamp: null },
              'apple_credential_unreadable',
            );
            totals.pending++;
            continue;
          }
          if (request.apple_token_kind === 'authorization_code') {
            if (
              !request.apple_code_created_at ||
              Date.now() - request.apple_code_created_at.getTime() >= 240_000
            )
              throw new AppleDeletionError('apple_authorization_expired');
            token = await apple.exchange(token, request.apple_subject_hash);
            // Persist before revoking; a transient revoke failure must not lose
            // the reusable refresh token after consuming the one-use code.
            const saved = await replaceCredentialMaterial(
              db,
              current,
              {
                ...credentialMaterial(current),
                ciphertext: encrypt(token, config),
                kind: 'refresh_token',
                codeTimestamp: null,
              },
              null,
            );
            if (!saved) {
              totals.pending++;
              continue;
            }
            current = saved;
          }
          await apple.revoke(token);
          const saved = await replaceCredentialMaterial(
            db,
            current,
            {
              ciphertext: null,
              kind: null,
              codeTimestamp: null,
              revokedTimestamp: new Date().toISOString(),
            },
            null,
          );
          if (!saved) {
            totals.pending++;
            continue;
          }
          current = saved;
        }
        await purgeAccount(db, current);
        totals.completed++;
      } catch (error) {
        const code =
          error instanceof AppleDeletionError ? error.code : 'deletion_processing_failed';
        if (code === 'apple_refresh_token_rejected') {
          // Only a definitive Apple rejection invalidates this durable token.
          // Network, key-configuration and server failures retain it for retry.
          await replaceCredentialMaterial(
            db,
            current,
            { ...credentialMaterial(current), ciphertext: null, kind: null, codeTimestamp: null },
            code,
          );
        } else {
          await replaceCredentialMaterial(db, current, credentialMaterial(current), code);
        }
        totals.pending++;
      }
    }
    return totals;
  } finally {
    if (held)
      await mutex.query(
        "SELECT pg_advisory_unlock(hashtext('recollect.account-deletion.processor'))",
      );
    mutex.release();
  }
}
