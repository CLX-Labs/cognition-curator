import Foundation
import SwiftData

@Model
final class Deck {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    var updatedAt: Date?
    var isPremium: Bool
    var isSuperset: Bool
    var isSilenced: Bool
    var silenceType: String?
    var silenceEndDate: Date?
    var combinedDeckIds: [String]?
    var syncStatus: String
    var needsSync: Bool
    var lastSyncedAt: Date?
    
    @Relationship(deleteRule: .cascade)
    var flashcards: [Flashcard]?
    
    init(id: UUID = UUID(),
         name: String,
         createdAt: Date = Date(),
         updatedAt: Date? = nil,
         isPremium: Bool = false,
         isSuperset: Bool = false,
         isSilenced: Bool = false,
         silenceType: String? = nil,
         silenceEndDate: Date? = nil,
         combinedDeckIds: [String]? = nil,
         syncStatus: String = "synced",
         needsSync: Bool = false,
         lastSyncedAt: Date? = nil) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isPremium = isPremium
        self.isSuperset = isSuperset
        self.isSilenced = isSilenced
        self.silenceType = silenceType
        self.silenceEndDate = silenceEndDate
        self.combinedDeckIds = combinedDeckIds
        self.syncStatus = syncStatus
        self.needsSync = needsSync
        self.lastSyncedAt = lastSyncedAt
        self.flashcards = []
    }
}

