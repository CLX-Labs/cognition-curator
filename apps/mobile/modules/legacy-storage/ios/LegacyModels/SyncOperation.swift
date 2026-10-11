import Foundation
import SwiftData

@Model
final class SyncOperation {
    @Attribute(.unique) var id: UUID
    var entityId: String
    var entityType: String
    var operation: String
    var payload: [String: AnyCodable]?
    var createdAt: Date
    var priority: Int16
    var retryCount: Int16
    var status: String
    var lastSyncedAt: Date?
    
    init(id: UUID = UUID(),
         entityId: String,
         entityType: String,
         operation: String,
         payload: [String: AnyCodable]? = nil,
         createdAt: Date = Date(),
         priority: Int16 = 1,
         retryCount: Int16 = 0,
         status: String = "pending",
         lastSyncedAt: Date? = nil) {
        self.id = id
        self.entityId = entityId
        self.entityType = entityType
        self.operation = operation
        self.payload = payload
        self.createdAt = createdAt
        self.priority = priority
        self.retryCount = retryCount
        self.status = status
        self.lastSyncedAt = lastSyncedAt
    }
}

