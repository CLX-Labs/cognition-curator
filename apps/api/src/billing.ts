import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  Environment,
  InAppOwnershipType,
  SignedDataVerifier,
  Type,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import {
  DomainError,
  grantPurchasedTokens,
  lockOwner,
  reversePurchasedTokenRefund,
  transaction,
  type Database,
} from '@recollect/db';

export const APPLE_TOKEN_PRODUCT_ID = 'collect.software.recollect.tokens.monthly';
export const APPLE_TOKEN_BUNDLE_ID = 'collect.software.cognition-curator';
export const APPLE_TOKEN_APP_ID = 6749138102;

export interface AppleBillingConfig {
  enabled: boolean;
  environment: 'Production' | 'Sandbox';
  bundleId: string;
  appAppleId: number;
  productId: string;
}

/** Injection is for local tests; production always uses Apple's certificate verifier. */
export interface AppleBillingVerifier {
  verifyAndDecodeTransaction(value: string): Promise<JWSTransactionDecodedPayload>;
  verifyAndDecodeNotification(value: string): Promise<ResponseBodyV2DecodedPayload>;
}

const rootCertificates = [
  [
    'AppleIncRootCertificate.cer',
    'b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024',
  ],
  ['AppleRootCA-G2.cer', 'c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050'],
  ['AppleRootCA-G3.cer', '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179'],
] as const;

/** Public trust anchors downloaded from https://www.apple.com/certificateauthority/. */
export function createAppleBillingVerifier(config: AppleBillingConfig): AppleBillingVerifier {
  const roots = rootCertificates.map(([name, fingerprint]) => {
    const certificate = readFileSync(new URL(`./apple-roots/${name}`, import.meta.url));
    if (createHash('sha256').update(certificate).digest('hex') !== fingerprint)
      throw new Error('The bundled Apple root certificate failed its integrity check.');
    return certificate;
  });
  return new SignedDataVerifier(
    roots,
    true,
    config.environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX,
    config.bundleId,
    config.appAppleId,
  );
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const appleIdPattern = /^\d{1,40}$/;
const clockTolerance = 5 * 60_000;

function invalid(message = 'This purchase could not be verified. Restore purchases or try again.') {
  return new DomainError('invalid_apple_purchase', message, 400);
}

function milliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class AppleBillingService {
  private verifier: AppleBillingVerifier | null;
  private now: () => Date;

  constructor(
    private db: Database,
    readonly config: AppleBillingConfig,
    options: { verifier?: AppleBillingVerifier; now?: () => Date } = {},
  ) {
    // A disabled deployment neither loads billing credentials nor makes Apple requests.
    this.verifier = config.enabled
      ? (options.verifier ?? createAppleBillingVerifier(config))
      : null;
    this.now = options.now ?? (() => new Date());
  }

  private requireVerifier(): AppleBillingVerifier {
    if (!this.verifier)
      throw new DomainError(
        'billing_unavailable',
        'Token subscriptions are not available yet.',
        503,
      );
    return this.verifier;
  }

  private async verify<T>(work: (verifier: AppleBillingVerifier) => Promise<T>): Promise<T> {
    const verifier = this.requireVerifier();
    try {
      return await work(verifier);
    } catch (error) {
      if (
        error instanceof VerificationException &&
        error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
      )
        throw new DomainError(
          'apple_verification_unavailable',
          'Apple purchase verification is temporarily unavailable. Try again shortly.',
          503,
        );
      throw invalid();
    }
  }

  private validatedPurchase(decoded: JWSTransactionDecodedPayload, expectedOwner?: string) {
    const now = this.now().getTime();
    if (
      decoded.bundleId !== this.config.bundleId ||
      decoded.productId !== this.config.productId ||
      decoded.environment !== this.config.environment ||
      decoded.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION ||
      decoded.inAppOwnershipType !== InAppOwnershipType.PURCHASED ||
      !decoded.appAccountToken ||
      !uuidPattern.test(decoded.appAccountToken) ||
      (expectedOwner !== undefined &&
        decoded.appAccountToken.toLowerCase() !== expectedOwner.toLowerCase()) ||
      !decoded.transactionId ||
      !appleIdPattern.test(decoded.transactionId) ||
      !decoded.originalTransactionId ||
      !appleIdPattern.test(decoded.originalTransactionId) ||
      !milliseconds(decoded.purchaseDate) ||
      !milliseconds(decoded.expiresDate) ||
      !milliseconds(decoded.signedDate) ||
      decoded.purchaseDate > now + clockTolerance ||
      decoded.signedDate > now + clockTolerance ||
      decoded.expiresDate <= decoded.purchaseDate ||
      decoded.purchaseDate > decoded.signedDate + clockTolerance ||
      (decoded.quantity !== undefined && decoded.quantity !== 1) ||
      (decoded.revocationDate !== undefined &&
        (!milliseconds(decoded.revocationDate) || decoded.revocationDate > now + clockTolerance))
    )
      throw invalid();

    return {
      owner: decoded.appAccountToken.toLowerCase(),
      transactionId: decoded.transactionId,
      originalTransactionId: decoded.originalTransactionId,
      productId: decoded.productId,
      purchasedAt: new Date(decoded.purchaseDate),
      expiresAt: new Date(decoded.expiresDate),
      signedAt: new Date(decoded.signedDate),
      environment: decoded.environment,
      revokedAt: decoded.revocationDate === undefined ? null : new Date(decoded.revocationDate),
    };
  }

  async purchase(
    owner: string,
    signedTransaction: string,
  ): Promise<{ transactionId: string; credited: boolean }> {
    const decoded = await this.verify((verifier) =>
      verifier.verifyAndDecodeTransaction(signedTransaction),
    );
    const purchase = this.validatedPurchase(decoded, owner);
    const credited = await transaction(this.db, async (tx) => {
      await lockOwner(tx, owner);
      return grantPurchasedTokens(tx, owner, purchase, this.now());
    });
    // A replay is a successful acknowledgement, so StoreKit can finish its transaction.
    return { transactionId: purchase.transactionId, credited };
  }

  async notification(signedPayload: string): Promise<{ received: true }> {
    const notification = await this.verify((verifier) =>
      verifier.verifyAndDecodeNotification(signedPayload),
    );
    if (
      notification.version !== '2.0' ||
      !notification.notificationUUID ||
      !uuidPattern.test(notification.notificationUUID) ||
      !milliseconds(notification.signedDate) ||
      notification.signedDate > this.now().getTime() + clockTolerance
    )
      throw invalid('The App Store notification could not be verified.');
    const data = notification.data;
    if (
      data &&
      (data.bundleId !== this.config.bundleId ||
        data.environment !== this.config.environment ||
        (this.config.environment === 'Production' && data.appAppleId !== this.config.appAppleId))
    )
      throw invalid();
    if (notification.notificationType === 'TEST') return { received: true };
    const grants = ['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED'];
    const revocations = ['REFUND', 'REVOKE'];
    const reversesRefund = notification.notificationType === 'REFUND_REVERSED';
    // Status/renewal-preference messages do not represent a payment. Never grant from them.
    if (
      !grants.includes(notification.notificationType ?? '') &&
      !revocations.includes(notification.notificationType ?? '') &&
      !reversesRefund
    )
      return { received: true };
    if (!data?.signedTransactionInfo) throw invalid();
    const decoded = await this.verify((verifier) =>
      verifier.verifyAndDecodeTransaction(data.signedTransactionInfo!),
    );
    const purchase = this.validatedPurchase(decoded);
    if (revocations.includes(notification.notificationType!) && purchase.revokedAt === null)
      throw invalid();
    try {
      await transaction(this.db, async (tx) => {
        await lockOwner(tx, purchase.owner);
        if (reversesRefund) {
          // Only Apple's signed reversal event may undo a refund. Client restores
          // cannot do so, even when they replay an older unrevoked transaction.
          await reversePurchasedTokenRefund(
            tx,
            purchase.owner,
            { ...purchase, revokedAt: null },
            {
              notificationSignedAt: new Date(notification.signedDate!),
            },
            this.now(),
          );
        } else {
          // Refunds remove only unspent credits. Signed event ordering prevents
          // a delayed refund from undoing a newer, verified refund reversal.
          await grantPurchasedTokens(
            tx,
            purchase.owner,
            {
              ...purchase,
              ...(revocations.includes(notification.notificationType!)
                ? { refundEventSignedAt: new Date(notification.signedDate!) }
                : {}),
            },
            this.now(),
          );
        }
      });
    } catch (error) {
      // Deleted accounts must not be recreated by a delayed Apple notification.
      if (!(error instanceof DomainError && error.code === 'account_inactive')) throw error;
    }
    return { received: true };
  }
}

export function createAppleBillingService(db: Database, config: AppleBillingConfig) {
  return new AppleBillingService(db, config);
}
