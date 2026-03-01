import SwiftUI
import Foundation

class DeepLinkHandler: ObservableObject {
    @Published var targetCardId: UUID?
    @Published var shouldOpenReview = false
    @Published var selectedTab = 2 // Review tab is index 2

    /// W4 Fix: Flag to indicate if a specific card was requested but may not exist
    @Published var hasSpecificCardRequest = false

    /// W4 Fix: Message to show when card validation fails
    @Published var cardNotFoundMessage: String?

    func handle(url: URL) {
        guard url.scheme == "cognitioncurator" else { return }

        // Reset state
        cardNotFoundMessage = nil
        hasSpecificCardRequest = false

        let path = url.host ?? ""
        let pathComponents = url.pathComponents.filter { $0 != "/" }

        switch path {
        case "review":
            if pathComponents.count > 0, let cardIdString = pathComponents.first {
                // Widget clicked with specific card ID
                if let cardId = UUID(uuidString: cardIdString) {
                    targetCardId = cardId
                    hasSpecificCardRequest = true
                    print("🔗 DeepLinkHandler: Card ID requested: \(cardId)")
                } else {
                    print("⚠️ DeepLinkHandler: Invalid card ID format: \(cardIdString)")
                }
            }

            // Navigate to review tab and trigger review
            selectedTab = 2 // Review tab index
            shouldOpenReview = true

        default:
            // Default to opening the review tab
            selectedTab = 2
            shouldOpenReview = true
        }
    }

    /// W4 Fix: Call this when the target card was not found in the database
    func markCardNotFound() {
        cardNotFoundMessage = "The flashcard from the widget is no longer available. Showing all due cards instead."
        targetCardId = nil
        hasSpecificCardRequest = false
        print("⚠️ DeepLinkHandler: Target card not found, cleared request")
    }

    func clearDeepLink() {
        targetCardId = nil
        shouldOpenReview = false
        hasSpecificCardRequest = false
        cardNotFoundMessage = nil
    }

    /// W4 Fix: Dismiss the card not found message
    func dismissCardNotFoundMessage() {
        cardNotFoundMessage = nil
    }
}
