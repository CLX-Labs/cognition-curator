import XCTest
import SwiftData
import SQLite3
@testable import cognition_curator

final class LegacyStorageTests: XCTestCase {
  var root: URL!
  var defaults: UserDefaults!
  var defaultsSuite: String!

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defaultsSuite = "RecollectLegacyStorageTests.\(UUID().uuidString)"
    defaults = UserDefaults(suiteName: defaultsSuite)!
  }

  override func tearDownWithError() throws {
    defaults.removePersistentDomain(forName: defaultsSuite)
    try FileManager.default.removeItem(at: root)
  }

  func testMissingStoreNeverCreatesDatabaseOrClaimsMigration() throws {
    let reader = LegacyStoreReader(defaults: defaults, sources: [], archiveRoot: root)
    let result = try JSONSerialization.jsonObject(with: Data(reader.exportJSON().utf8)) as! [String: Any]
    XCTAssertEqual(result["status"] as? String, "needs_recovery")
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
  }

  func testConsistentBackupIncludesUncheckpointedWALWithoutChangingSource() throws {
    let source = root.appendingPathComponent("source.sqlite")
    let backup = root.appendingPathComponent("backup.sqlite")
    var database: OpaquePointer?
    XCTAssertEqual(sqlite3_open(source.path, &database), SQLITE_OK)
    defer { sqlite3_close(database) }
    XCTAssertEqual(sqlite3_exec(database, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE events(id TEXT PRIMARY KEY); INSERT INTO events VALUES('one');", nil, nil, nil), SQLITE_OK)
    let sourceHash = try LegacyStoreReader.fileHash(source)
    let wal = URL(fileURLWithPath: source.path + "-wal")
    let walHash = try LegacyStoreReader.fileHash(wal)
    try SQLiteSnapshot.create(from: source, to: backup)
    XCTAssertEqual(try LegacyStoreReader.fileHash(source), sourceHash)
    XCTAssertEqual(try LegacyStoreReader.fileHash(wal), walHash)
    var copied: OpaquePointer?
    XCTAssertEqual(sqlite3_open_v2(backup.path, &copied, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
    defer { sqlite3_close(copied) }
    var query: OpaquePointer?
    XCTAssertEqual(sqlite3_prepare_v2(copied, "SELECT COUNT(*) FROM events", -1, &query, nil), SQLITE_OK)
    defer { sqlite3_finalize(query) }
    XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
    XCTAssertEqual(sqlite3_column_int(query, 0), 1)
  }

  func testArbitrarySQLiteRemainsRecoveryMaterialNotEmptySuccess() throws {
    let source = root.appendingPathComponent("unknown.store")
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(source.path, &db), SQLITE_OK)
    XCTAssertEqual(sqlite3_exec(db, "CREATE TABLE unsupported(value TEXT); INSERT INTO unsupported VALUES('preserve me');", nil, nil, nil), SQLITE_OK)
    sqlite3_close(db)
    let hash = try LegacyStoreReader.fileHash(source)
    let reader = makeReader(source)
    let result = try JSONSerialization.jsonObject(with: Data(reader.exportJSON().utf8)) as! [String: Any]
    XCTAssertEqual(result["status"] as? String, "needs_recovery")
    let repeated = try JSONSerialization.jsonObject(with: Data(reader.exportJSON().utf8)) as! [String: Any]
    XCTAssertEqual(repeated["backupFileUri"] as? String, result["backupFileUri"] as? String)
    XCTAssertEqual(try LegacyStoreReader.fileHash(source), hash)
    let archive = root.appendingPathComponent("archive")
    let directories = try FileManager.default.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)
    XCTAssertEqual(directories.count, 1)
    XCTAssertTrue(FileManager.default.fileExists(atPath: directories[0].appendingPathComponent("original.snapshot.store").path))
  }

  @MainActor
  func testLegacyExportPreservesIDsSchedulePendingEvidenceAndHasNoCredentials() throws {
    let source = root.appendingPathComponent("default.store")
    let configuration = ModelConfiguration(schema: LegacyStoreReader.schema, url: source, cloudKitDatabase: .none)
    let container = try ModelContainer(for: LegacyStoreReader.schema, configurations: [configuration])
    let context = ModelContext(container)
    context.autosaveEnabled = false
    let accountID = UUID().uuidString
    defaults.set(accountID, forKey: "currentUserId")
    defaults.set("must-not-export-this-token", forKey: "jwtToken")
    defaults.set(["id": accountID, "email": "private@example.test"], forKey: "cachedUserAccount")
    defaults.set(["legacy": ["id": accountID, "password": "must-not-export-password"]], forKey: "storedUsers")
    defaults.set("normal", forKey: "reviewMode")
    let deck = Deck(name: "Preserved deck", isSilenced: true, silenceType: "permanent")
    let card = Flashcard(question: "Local generated card", answer: "Keep local UUID", deck: deck)
    let reviewed = Date(timeIntervalSince1970: 1_790_000_000)
    let session = ReviewSession(difficulty: 2, easeFactor: 2.5, interval: 10, reviewedAt: reviewed,
      nextReview: reviewed.addingTimeInterval(600), flashcard: card)
    let operation = SyncOperation(entityId: UUID().uuidString, entityType: "ReviewSession", operation: "review",
      payload: ["flashcard_id": AnyCodable(card.id.uuidString)], retryCount: 3, status: "failed")
    context.insert(deck)
    context.insert(card)
    context.insert(session)
    context.insert(operation)
    try context.save()
    let originalHash = try LegacyStoreReader.fileHash(source)
    let reader = makeReader(source)
    let export = try reader.export()
    let again = try reader.export()
    XCTAssertEqual(try LegacyStoreReader.fileHash(source), originalHash)
    let manifest = export["manifest"] as! [String: Any]
    let secondManifest = again["manifest"] as! [String: Any]
    XCTAssertEqual(manifest["exportId"] as? String, secondManifest["exportId"] as? String)
    let cards = export["cards"] as! [[String: Any]]
    let reviews = export["reviews"] as! [[String: Any]]
    let operations = export["pendingOps"] as! [[String: Any]]
    XCTAssertEqual(cards.first?["id"] as? String, card.id.uuidString)
    XCTAssertEqual(reviews.first?["id"] as? String, session.id.uuidString)
    XCTAssertEqual(reviews.first?["intervalMinutes"] as? Double, 10)
    XCTAssertEqual(reviews.first?["reviewedAt"] as? String, LegacyStoreReader.iso(reviewed))
    XCTAssertEqual(operations.first?["status"] as? String, "failed")
    XCTAssertEqual((export["ownerHints"] as? [String: Any])?["trusted"] as? Bool, false)
    let json = try LegacyStoreReader.json(export)
    XCTAssertFalse(json.contains("must-not-export"))
    XCTAssertFalse(json.contains("private@example.test"))
    XCTAssertFalse(json.contains("jwtToken"))
  }

  private func makeReader(_ source: URL) -> LegacyStoreReader {
    LegacyStoreReader(defaults: defaults, sources: [LegacyStoreCandidate(url: source, location: "application_support", sourceId: "test-original-store")],
      archiveRoot: root.appendingPathComponent("archive", isDirectory: true))
  }
}
