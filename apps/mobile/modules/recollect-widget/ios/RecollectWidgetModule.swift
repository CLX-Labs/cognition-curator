import ExpoModulesCore
import Foundation
import WidgetKit

public final class RecollectWidgetModule: Module {
  private let queue = DispatchQueue(label: "app.recollect.widget-publish")

  public func definition() -> ModuleDefinition {
    Name("RecollectWidget")
    AsyncFunction("setWidgetOwner") { (ownerId: String?) throws in
      let defaults = try Self.requireDefaults()
      RecollectWidgetStore.clear(defaults)
      if let ownerId {
        guard UUID(uuidString: ownerId) != nil else { throw Self.failure("Invalid widget account.") }
        defaults.set(ownerId.lowercased(), forKey: RecollectWidgetStore.ownerKey)
        defaults.synchronize()
      }
      Self.reload()
    }.runOnQueue(queue)

    AsyncFunction("publishWidget") { (json: String?) throws in
      let defaults = try Self.requireDefaults()
      guard let json else {
        RecollectWidgetStore.clear(defaults)
        Self.reload()
        return
      }
      guard json.utf8.count <= 131_072, let data = json.data(using: .utf8) else { throw Self.failure("Widget content is too large.") }
      let snapshot = try JSONDecoder().decode(RecollectWidgetSnapshot.self, from: data)
      guard snapshot.ownerId.lowercased() == defaults.string(forKey: RecollectWidgetStore.ownerKey),
            UUID(uuidString: snapshot.ownerId) != nil, snapshot.dueCount >= 0,
            snapshot.topCard.map({ UUID(uuidString: $0.id) != nil }) ?? true else {
        throw Self.failure("Widget update does not match the active account.")
      }
      let safeCard = snapshot.topCard.map {
        RecollectWidgetCard(id: $0.id, question: String($0.question.prefix(500)), answer: String($0.answer.prefix(500)), deckName: String($0.deckName.prefix(100)))
      }
      let safeSnapshot = RecollectWidgetSnapshot(ownerId: snapshot.ownerId.lowercased(), dueCount: snapshot.dueCount,
        hasCards: snapshot.hasCards, updatedAt: snapshot.updatedAt, topCard: safeCard)
      // One encoded value makes content updates atomic at the snapshot level.
      defaults.set(try JSONEncoder().encode(safeSnapshot), forKey: RecollectWidgetStore.snapshotKey)
      defaults.synchronize()
      Self.reload()
    }.runOnQueue(queue)
  }

  private static func requireDefaults() throws -> UserDefaults {
    guard let defaults = RecollectWidgetStore.defaults() else {
      throw failure("The shared widget container is unavailable. Check this build's App Group entitlement.")
    }
    return defaults
  }
  private static func failure(_ message: String) -> NSError {
    NSError(domain: "RecollectWidget", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private static func reload() {
    WidgetCenter.shared.reloadTimelines(ofKind: "CognitionCuratorWidget")
    if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: "CognitionCuratorWidgetControl") }
  }
}
