import Foundation
import SwiftData

@Model
final class ReviewSession {
    @Attribute(.unique) var id: UUID
    var difficulty: Int16
    var easeFactor: Double
    var interval: Double
    var reviewedAt: Date
    var nextReview: Date?
    var syncStatus: String
    var needsSync: Bool
    var lastSyncedAt: Date?
    
    @Relationship(deleteRule: .nullify)
    var flashcard: Flashcard?
    
    init(id: UUID = UUID(),
         difficulty: Int16,
         easeFactor: Double,
         interval: Double,
         reviewedAt: Date = Date(),
         nextReview: Date? = nil,
         syncStatus: String = "pending",
         needsSync: Bool = true,
         lastSyncedAt: Date? = nil,
         flashcard: Flashcard? = nil) {
        self.id = id
        self.difficulty = difficulty
        self.easeFactor = easeFactor
        self.interval = interval
        self.reviewedAt = reviewedAt
        self.nextReview = nextReview
        self.syncStatus = syncStatus
        self.needsSync = needsSync
        self.lastSyncedAt = lastSyncedAt
        self.flashcard = flashcard
    }
}

