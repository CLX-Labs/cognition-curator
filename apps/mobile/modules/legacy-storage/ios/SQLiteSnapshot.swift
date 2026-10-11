import Foundation
import SQLite3

enum LegacyRecoveryFailure: Error, Equatable {
  case unavailable, ambiguousStores, unsafePath, unreadableStore, backupFailed
  case unsupportedSchema, changedSnapshot, invalidRelationships, invalidExport

  var message: String {
    switch self {
    case .unavailable: return "The original store was not found. Recovery has not been marked complete."
    case .ambiguousStores: return "More than one legacy store was found. Preserve them for explicit recovery."
    case .unsafePath: return "The legacy store is not a regular file in a supported location."
    case .unreadableStore: return "The original store could not be read. Unlock the device and retry; do not reinstall the app."
    case .backupFailed: return "A consistent recovery backup could not be completed. The original store is unchanged."
    case .unsupportedSchema: return "This legacy schema could not be opened safely. Its protected backup requires a compatible recovery reader."
    case .changedSnapshot: return "Opening this schema changed the working snapshot. The original backup was preserved for recovery."
    case .invalidRelationships: return "The recovered records contain unresolved relationships. Preserve the export for explicit reconciliation."
    case .invalidExport: return "The recovery export could not be validated. The original store and backup are preserved."
    }
  }
}

/** SQLite's online backup API includes committed WAL content without checkpointing the source. */
enum SQLiteSnapshot {
  static func create(from source: URL, to destination: URL) throws {
    guard FileManager.default.fileExists(atPath: source.path),
          !FileManager.default.fileExists(atPath: destination.path) else {
      throw LegacyRecoveryFailure.unsafePath
    }
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw LegacyRecoveryFailure.unsafePath
    }
    var sourceDB: OpaquePointer?
    guard sqlite3_open_v2(source.path, &sourceDB, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      if let sourceDB { sqlite3_close(sourceDB) }
      throw LegacyRecoveryFailure.unreadableStore
    }
    defer { sqlite3_close(sourceDB) }
    sqlite3_busy_timeout(sourceDB, 1500)

    var destinationDB: OpaquePointer?
    guard sqlite3_open_v2(destination.path, &destinationDB, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
      if let destinationDB { sqlite3_close(destinationDB) }
      throw LegacyRecoveryFailure.backupFailed
    }
    defer { sqlite3_close(destinationDB) }
    guard let backup = sqlite3_backup_init(destinationDB, "main", sourceDB, "main") else {
      throw LegacyRecoveryFailure.backupFailed
    }
    let deadline = Date().addingTimeInterval(15)
    var result: Int32 = SQLITE_OK
    repeat {
      result = sqlite3_backup_step(backup, 256)
      if result == SQLITE_BUSY || result == SQLITE_LOCKED { Thread.sleep(forTimeInterval: 0.025) }
    } while (result == SQLITE_OK || result == SQLITE_BUSY || result == SQLITE_LOCKED) && Date() < deadline
    let finish = sqlite3_backup_finish(backup)
    guard result == SQLITE_DONE, finish == SQLITE_OK else { throw LegacyRecoveryFailure.backupFailed }

    var check: OpaquePointer?
    guard sqlite3_prepare_v2(destinationDB, "PRAGMA quick_check", -1, &check, nil) == SQLITE_OK else {
      throw LegacyRecoveryFailure.backupFailed
    }
    defer { sqlite3_finalize(check) }
    guard sqlite3_step(check) == SQLITE_ROW,
          let value = sqlite3_column_text(check, 0), String(cString: value) == "ok" else {
      throw LegacyRecoveryFailure.backupFailed
    }
  }
}
