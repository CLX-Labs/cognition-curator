//
//  CognitionCuratorWidgetControl.swift
//  CognitionCuratorWidget
//
//  Created by Nick Gattuso on 7/27/25.
//

import AppIntents
import SwiftUI
import WidgetKit

struct CognitionCuratorWidgetControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(
            kind: "CognitionCuratorWidgetControl",
            provider: ReviewProvider()
        ) { reviewData in
            ControlWidgetButton(action: LaunchReviewIntent()) {
                VStack(spacing: 2) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 16, weight: .medium))
                    if reviewData.dueCount > 0 {
                        Text("\(reviewData.dueCount)")
                            .font(.system(size: 12, weight: .semibold))
                    } else {
                        Text("Study")
                            .font(.system(size: 10, weight: .medium))
                    }
                }
                .foregroundColor(.white)
            }
        }
        .displayName("Review Cards")
        .description("Quick access to flashcard review with due count.")
    }
}

extension CognitionCuratorWidgetControl {
    struct ReviewData {
        let dueCount: Int
        let hasCards: Bool
    }

    struct ReviewProvider: ControlValueProvider {
        var previewValue: ReviewData {
            ReviewData(dueCount: 5, hasCards: true)
        }

        func currentValue() async throws -> ReviewData {
            return getDueCardsCount()
        }

        private func getDueCardsCount() -> ReviewData {
            // W3 Fix: Return safe default instead of using standard UserDefaults (which won't share data)
            guard let sharedDefaults = UserDefaults(suiteName: "group.collect.software.cognition-curator") else {
                // App Group not available - return safe default
                return ReviewData(dueCount: 0, hasCards: false)
            }

            let dueCount = sharedDefaults.integer(forKey: "widget.dueCardsCount")
            let hasCards = sharedDefaults.bool(forKey: "widget.hasCards")

            return ReviewData(dueCount: dueCount, hasCards: hasCards)
        }
    }
}

struct LaunchReviewIntent: AppIntent {
    static let title: LocalizedStringResource = "Launch Flashcard Review"
    static let description = IntentDescription("Opens the app to review flashcards")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        // Use URL to trigger app opening and navigation
        if let url = URL(string: "cognitioncurator://review") {
            try await OpenURLIntent(url).perform()
        }
        return .result()
    }
}
