import ExpoModulesCore
import Foundation
import StoreKit

private let tokenProductID = "collect.software.recollect.tokens.monthly"

private func billingFailure(_ message: String) -> NSError {
  NSError(domain: "RecollectBilling", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private actor RecollectTransactionStore {
  private var transactions: [UInt64: StoreKit.Transaction] = [:]

  func stage(_ result: VerificationResult<StoreKit.Transaction>) throws -> [String: String]? {
    guard case .verified(let transaction) = result else {
      throw billingFailure("Apple could not verify this transaction. Restore purchases or try again.")
    }
    guard transaction.productID == tokenProductID else { return nil }
    transactions[transaction.id] = transaction
    return [
      "transactionId": String(transaction.id),
      "appAccountToken": transaction.appAccountToken?.uuidString.lowercased() ?? "",
      "signedTransaction": result.jwsRepresentation
    ]
  }

  func finish(_ identifier: String) async throws {
    guard let id = UInt64(identifier) else { throw billingFailure("Invalid Apple transaction identifier.") }
    // A purchase response and its updates event may acknowledge the same delivery.
    guard let transaction = transactions[id] else { return }
    // JavaScript calls this only after the API has committed its verified, idempotent grant.
    await transaction.finish()
    transactions.removeValue(forKey: id)
  }
}

public final class RecollectBillingModule: Module {
  private let store = RecollectTransactionStore()
  private var updatesTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("RecollectBilling")
    Events("onTransaction")

    OnCreate { [weak self] in
      guard let self else { return }
      self.updatesTask = Task { [weak self] in
        for await result in StoreKit.Transaction.updates {
          if Task.isCancelled { break }
          guard let self else { break }
          // Unverified transactions stay unfinished and never unlock credits.
          if let proof = try? await self.store.stage(result) {
            self.sendEvent("onTransaction", proof)
          }
        }
      }
    }

    OnDestroy { [weak self] in
      self?.updatesTask?.cancel()
      self?.updatesTask = nil
    }

    AsyncFunction("getAvailability") { AppStore.canMakePayments }

    AsyncFunction("getProduct") { () async throws -> [String: String]? in
      guard let product = try await Self.product() else { return nil }
      return [
        "productId": product.id,
        "displayName": product.displayName,
        "description": product.description,
        "displayPrice": product.displayPrice,
        "subscriptionPeriod": "month"
      ]
    }

    AsyncFunction("purchase") { (accountToken: String) async throws -> [String: Any] in
      guard AppStore.canMakePayments else {
        throw billingFailure("Purchases are disabled on this device.")
      }
      guard let owner = UUID(uuidString: accountToken) else {
        throw billingFailure("Sign in before subscribing to generation tokens.")
      }
      guard let product = try await Self.product() else {
        throw billingFailure("This subscription is not available in the App Store yet.")
      }
      switch try await product.purchase(options: [.appAccountToken(owner)]) {
      case .success(let result):
        guard let proof = try await self.store.stage(result) else {
          throw billingFailure("The purchased subscription does not match Recollect tokens.")
        }
        return ["status": "purchased", "transaction": proof]
      case .userCancelled:
        return ["status": "cancelled"]
      case .pending:
        return ["status": "pending"]
      @unknown default:
        throw billingFailure("Apple has not completed this purchase. Try restoring purchases shortly.")
      }
    }

    AsyncFunction("pendingTransactions") { () async throws -> [[String: String]] in
      var proofs: [[String: String]] = []
      for await result in StoreKit.Transaction.unfinished {
        if let proof = try await self.store.stage(result) { proofs.append(proof) }
      }
      return proofs
    }

    AsyncFunction("restore") { () async throws -> [[String: String]] in
      // This action is user initiated. Do not call AppStore.sync from background recovery.
      try await AppStore.sync()
      var proofs: [[String: String]] = []
      // all includes missed renewal periods, not only the current entitlement.
      // The API credits each purchased transaction once; restored credits never expire.
      for await result in StoreKit.Transaction.all {
        if let proof = try await self.store.stage(result) { proofs.append(proof) }
      }
      return proofs
    }

    AsyncFunction("finish") { (transactionID: String) async throws in
      try await self.store.finish(transactionID)
    }
  }

  private static func product() async throws -> Product? {
    guard let product = try await Product.products(for: [tokenProductID]).first,
      product.type == .autoRenewable,
      let period = product.subscription?.subscriptionPeriod,
      period.unit == .month, period.value == 1 else { return nil }
    return product
  }
}
