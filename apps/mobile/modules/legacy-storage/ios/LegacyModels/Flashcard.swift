import Foundation
import SwiftData

@Model
final class Flashcard {
    @Attribute(.unique) var id: UUID
    var question: String
    var answer: String
    var createdAt: Date
    var updatedAt: Date?
    var metadata: [String: AnyCodable]?
    var syncStatus: String
    var needsSync: Bool
    var lastSyncedAt: Date?
    
    @Relationship(deleteRule: .nullify)
    var deck: Deck?
    
    @Relationship(deleteRule: .cascade)
    var reviewSessions: [ReviewSession]?
    
    init(id: UUID = UUID(),
         question: String,
         answer: String,
         createdAt: Date = Date(),
         updatedAt: Date? = nil,
         metadata: [String: AnyCodable]? = nil,
         syncStatus: String = "synced",
         needsSync: Bool = false,
         lastSyncedAt: Date? = nil,
         deck: Deck? = nil) {
        self.id = id
        self.question = question
        self.answer = answer
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.metadata = metadata
        self.syncStatus = syncStatus
        self.needsSync = needsSync
        self.lastSyncedAt = lastSyncedAt
        self.deck = deck
        self.reviewSessions = []
    }
}

