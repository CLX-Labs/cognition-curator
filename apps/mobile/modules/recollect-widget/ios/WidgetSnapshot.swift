import Foundation

struct RecollectWidgetCard: Codable {
  let id: String
  let question: String
  let answer: String
  let deckName: String
}

struct RecollectWidgetSnapshot: Codable {
  let ownerId: String
  let dueCount: Int
  let hasCards: Bool
  let updatedAt: String
  let topCard: RecollectWidgetCard?
}

enum RecollectWidgetStore {
  static let group = "group.collect.software.cognition-curator"
  static let snapshotKey = "recollect.widget.snapshot.v1"
  static let ownerKey = "recollect.widget.owner.v1"
  static let oldKeys = ["widget.dueCardsCount", "widget.hasCards", "widget.lastUpdated", "widget.topCard.hasContent",
                        "widget.topCard.question", "widget.topCard.answer", "widget.topCard.deckName", "widget.topCard.cardId"]

  static func defaults() -> UserDefaults? {
    guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else { return nil }
    return UserDefaults(suiteName: group)
  }

  static func read() -> RecollectWidgetSnapshot? {
    guard let defaults = defaults(), let owner = defaults.string(forKey: ownerKey),
          let data = defaults.data(forKey: snapshotKey),
          let snapshot = try? JSONDecoder().decode(RecollectWidgetSnapshot.self, from: data), snapshot.ownerId == owner else { return nil }
    return snapshot
  }

  static func clear(_ defaults: UserDefaults) {
    // Revoke ownership before clearing content; readers never display an unscoped legacy snapshot.
    defaults.removeObject(forKey: ownerKey)
    defaults.removeObject(forKey: snapshotKey)
    for key in oldKeys { defaults.removeObject(forKey: key) }
    defaults.synchronize()
  }
}
