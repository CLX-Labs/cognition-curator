import Foundation
import SwiftData

@Model
final class User {
    @Attribute(.unique) var id: UUID
    var premiumStatus: String
    var preferences: [String: AnyCodable]?
    var algorithmChoice: String
    
    init(id: UUID = UUID(),
         premiumStatus: String = "free",
         preferences: [String: AnyCodable]? = nil,
         algorithmChoice: String = "SM-2") {
        self.id = id
        self.premiumStatus = premiumStatus
        self.preferences = preferences
        self.algorithmChoice = algorithmChoice
    }
}

