import ExpoModulesCore
import Foundation

public final class RecollectLegacyStorageModule: Module {
  // One serial queue owns each transient ModelContext and all recovery filesystem work.
  private let recoveryQueue = DispatchQueue(label: "app.recollect.legacy-recovery")

  public func definition() -> ModuleDefinition {
    Name("RecollectLegacyStorage")
    AsyncFunction("inspectLegacyStore") { () throws -> String in
      try LegacyStoreReader().inspectionJSON()
    }.runOnQueue(recoveryQueue)
    AsyncFunction("exportLegacyStore") { () throws -> String in
      try LegacyStoreReader().exportJSON()
    }.runOnQueue(recoveryQueue)
  }
}
