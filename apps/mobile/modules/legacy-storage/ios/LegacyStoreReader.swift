import Foundation
import CoreData
import CryptoKit
import SwiftData

struct LegacyStoreCandidate {
  let url: URL
  let location: String
  let sourceId: String

  func dictionary() throws -> [String: Any] {
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    return ["sourceId": sourceId, "location": location, "fileName": url.lastPathComponent, "byteCount": size]
  }
}

/// No live original URL is ever passed to ModelContainer. No source record is saved or deleted.
struct LegacyStoreReader {
  static let groupIdentifier = "group.collect.software.cognition-curator"
  static let schemaSourceRevision = "a8ff38320b01d93438efe44694f72168a56ada7b"
  private let defaults: UserDefaults
  private let explicitSources: [LegacyStoreCandidate]?
  private let explicitArchiveRoot: URL?

  init(defaults: UserDefaults = .standard, sources: [LegacyStoreCandidate]? = nil, archiveRoot: URL? = nil) {
    self.defaults = defaults
    self.explicitSources = sources
    self.explicitArchiveRoot = archiveRoot
  }

  static var schema: Schema {
    Schema([Deck.self, Flashcard.self, ReviewSession.self, SyncOperation.self, User.self])
  }

  func ownerHints() -> [String: Any] {
    let cached = defaults.dictionary(forKey: "cachedUserAccount")
    let stored = defaults.dictionary(forKey: "storedUsers") ?? [:]
    let ids = stored.values.compactMap { ($0 as? [String: Any])?["id"] as? String }
      .filter { UUID(uuidString: $0) != nil }
    return [
      "trusted": false,
      "currentUserId": validID(defaults.string(forKey: "currentUserId")),
      "cachedUserId": validID(cached?["id"] as? String),
      "storedUserIds": Array(Set(ids)).sorted()
    ]
  }

  private func validID(_ value: String?) -> Any {
    guard let value, UUID(uuidString: value) != nil else { return NSNull() }
    return value
  }

  func inspectionJSON() throws -> String {
    do {
      let sources = try discover()
      let status = sources.count == 1 ? "found" : (sources.isEmpty ? "absent" : "needs_recovery")
      return try Self.json([
        "status": status, "sources": try sources.map { try $0.dictionary() }, "ownerHints": ownerHints(),
        "message": sources.count == 1 ? "A legacy store exists. Ownership and schema still require verification." :
          (sources.isEmpty ? "No supported legacy store was found. This is not a completed migration." : LegacyRecoveryFailure.ambiguousStores.message)
      ])
    } catch {
      return try Self.json(["status": "needs_recovery", "sources": [], "ownerHints": ownerHints(), "message": safeMessage(error)])
    }
  }

  func exportJSON() throws -> String {
    // Unsupported stores wait for recovery or a reader/source change, not an automatic retry loop.
    let fingerprint = try? sourceFingerprint()
    if let fingerprint, fingerprint == defaults.string(forKey: "recollect.recovery.failedFingerprint"),
       let previous = defaults.string(forKey: "recollect.recovery.failedResult") { return previous }
    defaults.removeObject(forKey: "recollect.recovery.lastBackupUri")
    do {
      let result = try Self.json(export())
      defaults.removeObject(forKey: "recollect.recovery.failedFingerprint")
      defaults.removeObject(forKey: "recollect.recovery.failedResult")
      return result
    } catch {
      var result: [String: Any] = ["status": "needs_recovery", "message": safeMessage(error)]
      if let backup = defaults.string(forKey: "recollect.recovery.lastBackupUri") { result["backupFileUri"] = backup }
      let encoded = try Self.json(result)
      if let fingerprint, let failure = error as? LegacyRecoveryFailure,
         [.unsupportedSchema, .changedSnapshot, .invalidRelationships, .invalidExport].contains(failure) {
        defaults.set(fingerprint, forKey: "recollect.recovery.failedFingerprint")
        defaults.set(encoded, forKey: "recollect.recovery.failedResult")
      }
      return encoded
    }
  }

  private func sourceFingerprint() throws -> String {
    let sources = try discover()
    guard sources.count == 1, let source = sources.first else { throw LegacyRecoveryFailure.ambiguousStores }
    let wal = URL(fileURLWithPath: source.url.path + "-wal")
    let walHash: String
    if FileManager.default.fileExists(atPath: wal.path) { walHash = try Self.fileHash(wal) }
    else { walHash = "none" }
    return Self.sha256(Data("reader-v1|\(Self.schemaSourceRevision)|\(source.sourceId)|\(try Self.fileHash(source.url))|\(walHash)".utf8))
  }

  func discover() throws -> [LegacyStoreCandidate] {
    if let explicitSources { return explicitSources }
    let manager = FileManager.default
    // Constructing configuration resolves its URL; it does not open/create a ModelContainer.
    let original = ModelConfiguration(schema: Self.schema, isStoredInMemoryOnly: false, cloudKitDatabase: .automatic)
    let sandbox = ModelConfiguration(schema: Self.schema, isStoredInMemoryOnly: false, groupContainer: .none, cloudKitDatabase: .none)
    var paths: [(URL, String)] = [(original.url, "configured"), (sandbox.url, "application_support")]
    if let group = manager.containerURL(forSecurityApplicationGroupIdentifier: Self.groupIdentifier) {
      let support = group.appendingPathComponent("Library/Application Support", isDirectory: true)
      paths.append((support.appendingPathComponent("default.store"), "app_group"))
      paths += try discoverSQLiteFiles(in: support, location: "app_group")
    }
    if let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
      paths += try discoverSQLiteFiles(in: support, location: "application_support")
    }
    let installationID: String
    if let stored = defaults.string(forKey: "recollect.recovery.installationId") { installationID = stored }
    else {
      installationID = UUID().uuidString
      defaults.set(installationID, forKey: "recollect.recovery.installationId")
    }
    var seen = Set<String>()
    var candidates: [LegacyStoreCandidate] = []
    for (url, location) in paths {
      guard manager.fileExists(atPath: url.path) else { continue }
      let canonical = url.standardizedFileURL
      guard seen.insert(canonical.path).inserted else { continue }
      let attributes = try canonical.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { throw LegacyRecoveryFailure.unsafePath }
      let sourceID = Self.sha256(Data("\(installationID)|\(canonical.path)".utf8))
      candidates.append(LegacyStoreCandidate(url: canonical, location: location, sourceId: sourceID))
    }
    return candidates.sorted { $0.url.path < $1.url.path }
  }

  private func discoverSQLiteFiles(in directory: URL, location: String) throws -> [(URL, String)] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
    return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
      .filter { ["store", "sqlite"].contains($0.pathExtension) }
      .map { ($0, location) }
  }

  func export() throws -> [String: Any] {
    let sources = try discover()
    guard !sources.isEmpty else { throw LegacyRecoveryFailure.unavailable }
    guard sources.count == 1, let source = sources.first else { throw LegacyRecoveryFailure.ambiguousStores }
    let root = try archiveRoot()
    let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try protect(directory)
    let backup = directory.appendingPathComponent("original.snapshot.store")
    try SQLiteSnapshot.create(from: source.url, to: backup)
    try protect(backup)
    defaults.set(backup.absoluteString, forKey: "recollect.recovery.lastBackupUri")
    let snapshotHash = try Self.fileHash(backup)
    // The recovery backup is retained unmodified, including on failures. Only a disposable copy is opened.
    let working = directory.appendingPathComponent("reader.store")
    try FileManager.default.copyItem(at: backup, to: working)
    try protect(working)
    let workingHash = try Self.fileHash(working)
    try validateStoreMetadata(at: working)
    let configuration = ModelConfiguration(schema: Self.schema, url: working, allowsSave: false, cloudKitDatabase: .none)
    let container: ModelContainer
    do { container = try ModelContainer(for: Self.schema, configurations: [configuration]) }
    catch { throw LegacyRecoveryFailure.unsupportedSchema }
    let context = ModelContext(container)
    context.autosaveEnabled = false

    let decks = try context.fetch(FetchDescriptor<Deck>()).sorted { $0.id.uuidString < $1.id.uuidString }
    let cards = try context.fetch(FetchDescriptor<Flashcard>()).sorted { $0.id.uuidString < $1.id.uuidString }
    let reviews = try context.fetch(FetchDescriptor<ReviewSession>()).sorted { $0.id.uuidString < $1.id.uuidString }
    let operations = try context.fetch(FetchDescriptor<SyncOperation>()).sorted { $0.id.uuidString < $1.id.uuidString }
    let users = try context.fetch(FetchDescriptor<User>()).sorted { $0.id.uuidString < $1.id.uuidString }
    try validateRelationships(decks: decks, cards: cards, reviews: reviews)

    var result: [String: Any] = [
      "status": "exported", "formatVersion": 1, "ownerHints": ownerHints(), "settings": settings(),
      "decks": decks.map { deck in [
        "id": deck.id.uuidString, "name": deck.name, "createdAt": Self.iso(deck.createdAt), "updatedAt": Self.dateOrNull(deck.updatedAt),
        "isPremium": deck.isPremium, "isSuperset": deck.isSuperset, "isSilenced": deck.isSilenced,
        "silenceType": Self.orNull(deck.silenceType), "silenceEndDate": Self.dateOrNull(deck.silenceEndDate),
        "combinedDeckIds": Self.orNull(deck.combinedDeckIds), "syncStatus": deck.syncStatus, "needsSync": deck.needsSync,
        "lastSyncedAt": Self.dateOrNull(deck.lastSyncedAt), "flashcardIds": (deck.flashcards ?? []).map { $0.id.uuidString }.sorted()
      ] as [String: Any] },
      "cards": try cards.map { card in [
        "id": card.id.uuidString, "question": card.question, "answer": card.answer,
        "createdAt": Self.iso(card.createdAt), "updatedAt": Self.dateOrNull(card.updatedAt),
        "metadata": try Self.codableDictionary(card.metadata), "deckId": Self.orNull(card.deck?.id.uuidString),
        "reviewSessionIds": (card.reviewSessions ?? []).map { $0.id.uuidString }.sorted(),
        "syncStatus": card.syncStatus, "needsSync": card.needsSync, "lastSyncedAt": Self.dateOrNull(card.lastSyncedAt)
      ] as [String: Any] },
      "reviews": reviews.map { review in [
        "id": review.id.uuidString, "difficulty": Int(review.difficulty), "easeFactor": review.easeFactor,
        "intervalMinutes": review.interval, "reviewedAt": Self.iso(review.reviewedAt), "nextReview": Self.dateOrNull(review.nextReview),
        "flashcardId": Self.orNull(review.flashcard?.id.uuidString), "syncStatus": review.syncStatus,
        "needsSync": review.needsSync, "lastSyncedAt": Self.dateOrNull(review.lastSyncedAt)
      ] as [String: Any] },
      "pendingOps": try operations.map { operation in [
        "id": operation.id.uuidString, "entityId": operation.entityId, "entityType": operation.entityType,
        "operation": operation.operation, "payload": try Self.codableDictionary(operation.payload), "createdAt": Self.iso(operation.createdAt),
        "priority": Int(operation.priority), "retryCount": Int(operation.retryCount), "status": operation.status,
        "lastSyncedAt": Self.dateOrNull(operation.lastSyncedAt)
      ] as [String: Any] },
      "users": try users.map { user in [
        "id": user.id.uuidString, "premiumStatus": user.premiumStatus,
        "preferences": try Self.codableDictionary(user.preferences), "algorithmChoice": user.algorithmChoice
      ] as [String: Any] }
    ]
    guard try Self.fileHash(working) == workingHash, try Self.fileHash(backup) == snapshotHash,
          try !Self.hasPersistentSidecar(at: working), try !Self.hasPersistentSidecar(at: backup) else {
      throw LegacyRecoveryFailure.changedSnapshot
    }
    let contentHash = Self.sha256(try Self.jsonData(result))
    let exportID = Self.sha256(Data("\(source.sourceId)|\(contentHash)".utf8))
    let exportFile = directory.appendingPathComponent("recovery.json")
    result["manifest"] = [
      "exportId": exportID, "contentSHA256": contentHash, "snapshotSHA256": snapshotHash,
      "exportedAt": Self.iso(Date()), "source": try source.dictionary(),
      "schemaIdentity": "cognition_curator", "schemaSourceRevision": Self.schemaSourceRevision,
      "dateEncoding": "iso8601_utc", "reviewIntervalUnit": "minutes",
      "counts": ["decks": decks.count, "cards": cards.count, "reviews": reviews.count, "pendingOps": operations.count, "users": users.count],
      "backupFileUri": backup.absoluteString, "exportFileUri": exportFile.absoluteString
    ]
    try Self.jsonData(result).write(to: exportFile, options: [.atomic])
    try protect(exportFile)
    return result
  }

  private func validateStoreMetadata(at url: URL) throws {
    do {
      let metadata = try NSPersistentStoreCoordinator.metadataForPersistentStore(ofType: NSSQLiteStoreType, at: url, options: [NSReadOnlyPersistentStoreOption: true])
      guard let hashes = metadata[NSStoreModelVersionHashesKey] as? [String: Any],
            Set(hashes.keys) == Set(["Deck", "Flashcard", "ReviewSession", "SyncOperation", "User"]) else {
        throw LegacyRecoveryFailure.unsupportedSchema
      }
    } catch { throw LegacyRecoveryFailure.unsupportedSchema }
  }

  private func validateRelationships(decks: [Deck], cards: [Flashcard], reviews: [ReviewSession]) throws {
    let deckIDs = Set(decks.map(\.id)), cardIDs = Set(cards.map(\.id)), reviewIDs = Set(reviews.map(\.id))
    guard deckIDs.count == decks.count, cardIDs.count == cards.count, reviewIDs.count == reviews.count,
      cards.allSatisfy({ $0.deck.map { deckIDs.contains($0.id) } ?? true }),
      reviews.allSatisfy({ $0.flashcard.map { cardIDs.contains($0.id) } ?? true }),
      decks.allSatisfy({ ($0.flashcards ?? []).allSatisfy { cardIDs.contains($0.id) } }),
      cards.allSatisfy({ ($0.reviewSessions ?? []).allSatisfy { reviewIDs.contains($0.id) } }) else {
      throw LegacyRecoveryFailure.invalidRelationships
    }
  }

  private func settings() -> [String: Any] {
    // Explicit allowlist. Never export jwtToken, passwords, cached user details or storedUsers.
    var result: [String: Any] = [:]
    for key in ["reviewMode", "maxNewCardsPerDay", "maxReviewCardsPerDay", "hasCompletedOnboarding"] {
      if let value = defaults.object(forKey: key) { result[key] = value }
    }
    return result
  }

  private func archiveRoot() throws -> URL {
    if let explicitArchiveRoot { return explicitArchiveRoot }
    guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      throw LegacyRecoveryFailure.backupFailed
    }
    return support.appendingPathComponent("RecollectLegacyRecovery", isDirectory: true)
  }

  private func protect(_ url: URL) throws {
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    #endif
  }

  private func safeMessage(_ error: Error) -> String {
    (error as? LegacyRecoveryFailure)?.message ?? LegacyRecoveryFailure.unreadableStore.message
  }

  static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }
  static func dateOrNull(_ date: Date?) -> Any {
    guard let date else { return NSNull() }
    return iso(date)
  }
  static func orNull<T>(_ value: T?) -> Any {
    guard let value else { return NSNull() }
    return value
  }
  static func codableDictionary(_ value: [String: AnyCodable]?) throws -> Any {
    guard let value else { return NSNull() }
    return try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
  }
  static func jsonData(_ object: Any) throws -> Data {
    guard JSONSerialization.isValidJSONObject(object) else { throw LegacyRecoveryFailure.invalidExport }
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  }
  static func json(_ object: Any) throws -> String {
    guard let text = String(data: try jsonData(object), encoding: .utf8) else { throw LegacyRecoveryFailure.invalidExport }
    return text
  }
  static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  static func fileHash(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hash = SHA256()
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  private static func hasPersistentSidecar(at url: URL) throws -> Bool {
    // Main-file hashes alone miss a migration/write recorded only in a WAL or rollback journal.
    // A read-only connection can create empty sidecars and SHM; those contain no changed rows.
    for suffix in ["-wal", "-journal"] {
      let sidecar = URL(fileURLWithPath: url.path + suffix)
      if FileManager.default.fileExists(atPath: sidecar.path),
         (try sidecar.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) > 0 { return true }
    }
    return false
  }
}
