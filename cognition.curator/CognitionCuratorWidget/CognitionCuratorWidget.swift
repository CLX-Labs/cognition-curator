//
//  CognitionCuratorWidget.swift
//  CognitionCuratorWidget
//
//  Created by Nick Gattuso on 7/27/25.
//

import WidgetKit
import SwiftUI

// MARK: - Timeline Provider
struct FlashcardProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReviewQuestionEntry {
        ReviewQuestionEntry(
            date: Date(),
            question: "What is spaced repetition?",
            answer: "A learning technique that uses increasing intervals of time between subsequent review of previously learned material.",
            deckName: "Study Techniques",
            cardId: nil,
            hasContent: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ReviewQuestionEntry) -> ()) {
        let entry = getNextReviewQuestion()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReviewQuestionEntry>) -> ()) {
        let currentEntry = getNextReviewQuestion()

        // Smart refresh timing based on content
        // Note: Widget will also refresh when app calls WidgetCenter.shared.reloadAllTimelines()
        let nextUpdate: Date

        if currentEntry.hasContent {
            // If showing a card, refresh in 15 minutes
            // The app will trigger immediate refresh when data changes
            nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        } else {
            // If no cards available, refresh in 30 minutes
            nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        }

        let timeline = Timeline(entries: [currentEntry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func getNextReviewQuestion() -> ReviewQuestionEntry {
        let appGroupId = "group.collect.software.cognition-curator"

        // Use App Groups to share data with main app
        // CRITICAL: Widget MUST use app group UserDefaults to access shared data
        guard let appGroupDefaults = UserDefaults(suiteName: appGroupId) else {
            print("❌ Widget: App Group '\(appGroupId)' NOT available - widget cannot access shared data!")
            print("❌ Widget: Check that app group is configured in both main app and widget entitlements")
            // Return error state
            return ReviewQuestionEntry(
                date: Date(),
                question: "Configuration Error",
                answer: "Widget cannot access app data. Please check app group configuration.",
                deckName: "Error",
                cardId: nil,
                hasContent: false
            )
        }

        let sharedDefaults = appGroupDefaults

        let dueCount = sharedDefaults.integer(forKey: "widget.dueCardsCount")
        let hasCards = sharedDefaults.bool(forKey: "widget.hasCards")
        let lastUpdated = sharedDefaults.object(forKey: "widget.lastUpdated") as? Date

        // Get actual card data
        let hasTopCard = sharedDefaults.bool(forKey: "widget.topCard.hasContent")
        let topCardQuestion = sharedDefaults.string(forKey: "widget.topCard.question")
        let topCardAnswer = sharedDefaults.string(forKey: "widget.topCard.answer")
        let topCardDeckName = sharedDefaults.string(forKey: "widget.topCard.deckName")
        let topCardIdString = sharedDefaults.string(forKey: "widget.topCard.cardId")
        let topCardId = topCardIdString != nil ? UUID(uuidString: topCardIdString!) : nil

        // Debug logging
        print("✅ Widget: App Group '\(appGroupId)' available")
        print("🎯 Widget: Reading data - Due: \(dueCount), HasCards: \(hasCards), HasTopCard: \(hasTopCard)")
        print("🎯 Widget: Last updated: \(lastUpdated?.description ?? "Never")")
        if hasTopCard {
            print("🎯 Widget: Top card question: '\(topCardQuestion ?? "nil")'")
            print("🎯 Widget: Top card deck: '\(topCardDeckName ?? "nil")'")
            print("🎯 Widget: Top card ID: '\(topCardIdString ?? "nil")'")
        } else {
            print("🎯 Widget: No top card data available")
        }

        // Show actual card content if available
        // Validate that all required fields are present and non-empty
        if hasTopCard,
           let question = topCardQuestion, !question.isEmpty,
           let answer = topCardAnswer, !answer.isEmpty,
           let deckName = topCardDeckName, !deckName.isEmpty {
            return ReviewQuestionEntry(
                date: Date(),
                question: question,
                answer: answer,
                deckName: deckName,
                cardId: topCardId,
                hasContent: true
            )
        } else if hasTopCard {
            // hasTopCard is true but data is incomplete - log and fall through to fallback
            print("⚠️ Widget: hasTopCard is true but data is incomplete or empty")
            print("  - Question: \(topCardQuestion ?? "nil")")
            print("  - Answer: \(topCardAnswer ?? "nil")")
            print("  - Deck: \(topCardDeckName ?? "nil")")
        }

        // Fallback to generic messages if no specific card available
        if hasCards && dueCount > 0 {
            // Show generic review prompt when we have due cards but no specific card data
            return ReviewQuestionEntry(
                date: Date(),
                question: "Ready to review?",
                answer: "You have \(dueCount) card\(dueCount == 1 ? "" : "s") ready for review",
                deckName: "Study Session",
                cardId: nil,
                hasContent: true
            )
        } else if hasCards {
            // Has cards but none due - encourage practice
            return ReviewQuestionEntry(
                date: Date(),
                question: "Keep practicing!",
                answer: "No cards due right now, but you can always practice",
                deckName: "Practice Mode",
                cardId: nil,
                hasContent: true
            )
        } else {
            // No cards at all or data not loaded yet
            let message = lastUpdated == nil ?
                "Open the app to sync your cards" :
                "Create some flashcard decks to get started!"

            return ReviewQuestionEntry(
                date: Date(),
                question: "No cards yet",
                answer: message,
                deckName: "Get Started",
                cardId: nil,
                hasContent: false
            )
        }
    }
}

// MARK: - Entry Model
struct ReviewQuestionEntry: TimelineEntry {
    let date: Date
    let question: String
    let answer: String
    let deckName: String
    let cardId: UUID?
    let hasContent: Bool
}

// MARK: - Widget Views
struct CognitionCuratorWidgetEntryView: View {
    var entry: FlashcardProvider.Entry

    private var widgetURL: URL? {
        if let cardId = entry.cardId {
            return URL(string: "cognitioncurator://review/\(cardId.uuidString)")
        } else {
            return URL(string: "cognitioncurator://review")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.blue)

                Text("Cognition Curator")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)

                Spacer()
            }

            Spacer()

            // Main content
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.question)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                Text(entry.answer)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
            }

            Spacer()

            // Footer
            HStack {
                Text(entry.deckName)
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Spacer()

                if entry.hasContent {
                    Text("Tap to Review")
                        .font(.caption2)
                        .foregroundColor(.blue)
                }
            }
        }
        .padding(12)
        .widgetURL(widgetURL)
    }
}

// MARK: - Widget Configuration
struct CognitionCuratorWidget: Widget {
    let kind: String = "CognitionCuratorWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FlashcardProvider()) { entry in
            if #available(iOS 17.0, *) {
                CognitionCuratorWidgetEntryView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                CognitionCuratorWidgetEntryView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("Flashcard Review")
        .description("Quick access to your flashcard review sessions with due card count.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
