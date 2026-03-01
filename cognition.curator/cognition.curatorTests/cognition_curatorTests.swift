//
//  cognition_curatorTests.swift
//  cognition.curatorTests
//
//  Created by Nicholas Gattuso on 7/13/25.
//  Updated for SwiftData compatibility on 2/28/26.
//

import XCTest
import SwiftUI
import SwiftData
@testable import cognition_curator

final class CognitionCuratorTests: XCTestCase {
    var container: ModelContainer!
    var context: ModelContext!

    @MainActor
    override func setUpWithError() throws {
        // Create in-memory container for isolated tests
        let schema = Schema([Deck.self, Flashcard.self, ReviewSession.self, User.self, SyncOperation.self])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        container = try ModelContainer(for: schema, configurations: [config])
        context = container.mainContext
    }

    override func tearDownWithError() throws {
        container = nil
        context = nil
    }

    // MARK: - Model Creation Tests

    @MainActor
    func testDeckCreation() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)
        try context.save()

        XCTAssertEqual(deck.name, "Test Deck")
        XCTAssertNotNil(deck.createdAt)
        XCTAssertNotNil(deck.id)
        XCTAssertEqual(deck.isPremium, false)
        XCTAssertEqual(deck.isSuperset, false)
        XCTAssertEqual(deck.isSilenced, false)
        XCTAssertEqual(deck.syncStatus, "synced")
        XCTAssertEqual(deck.needsSync, false)
    }

    @MainActor
    func testFlashcardCreation() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        let card = Flashcard(question: "What is 2+2?", answer: "4", deck: deck)
        context.insert(card)
        try context.save()

        XCTAssertEqual(card.question, "What is 2+2?")
        XCTAssertEqual(card.answer, "4")
        XCTAssertEqual(card.deck, deck)
        XCTAssertNotNil(card.createdAt)
        XCTAssertNotNil(card.id)
        XCTAssertEqual(card.syncStatus, "synced")

        // Verify relationship from deck side
        XCTAssertEqual(deck.flashcards?.count, 1)
        XCTAssertTrue(deck.flashcards?.contains(card) ?? false)
    }

    @MainActor
    func testReviewSessionCreation() throws {
        let card = Flashcard(question: "Test Question", answer: "Test Answer")
        context.insert(card)

        let nextReviewDate = Date().addingTimeInterval(86400) // 1 day from now
        let session = ReviewSession(
            difficulty: 3,
            easeFactor: 2.5,
            interval: 1440,  // 1 day in minutes
            nextReview: nextReviewDate,
            flashcard: card
        )
        context.insert(session)
        try context.save()

        XCTAssertEqual(session.difficulty, 3)
        XCTAssertEqual(session.easeFactor, 2.5)
        XCTAssertEqual(session.interval, 1440)
        XCTAssertEqual(session.nextReview, nextReviewDate)
        XCTAssertEqual(session.flashcard, card)
        XCTAssertNotNil(session.reviewedAt)
        XCTAssertEqual(session.syncStatus, "pending")
        XCTAssertEqual(session.needsSync, true)

        // Verify relationship from card side
        XCTAssertEqual(card.reviewSessions?.count, 1)
        XCTAssertTrue(card.reviewSessions?.contains(session) ?? false)
    }

    // MARK: - Spaced Repetition Tests

    @MainActor
    func testSpacedRepetitionCalculation() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        let card = Flashcard(question: "Test", answer: "Test", deck: deck)
        context.insert(card)
        try context.save()

        // Test with "Easy" difficulty (3)
        let nextReview = SpacedRepetitionService.shared.calculateNextReview(
            for: card,
            difficulty: 3,
            context: context
        )

        XCTAssertNotNil(nextReview)
        XCTAssertTrue(nextReview > Date(), "Next review should be in the future")

        // Verify a review session was created
        XCTAssertEqual(card.reviewSessions?.count, 1)
    }

    @MainActor
    func testSpacedRepetitionDifficultyLevels() throws {
        // Test all difficulty levels create valid future dates
        let difficulties: [Int16] = [0, 1, 2, 3]  // Again, Hard, Good, Easy

        for difficulty in difficulties {
            let card = Flashcard(question: "Q\(difficulty)", answer: "A\(difficulty)")
            context.insert(card)
            try context.save()

            let nextReview = SpacedRepetitionService.shared.calculateNextReview(
                for: card,
                difficulty: difficulty,
                context: context
            )

            XCTAssertNotNil(nextReview, "Difficulty \(difficulty) should produce valid next review")
            XCTAssertTrue(nextReview >= Date(), "Difficulty \(difficulty) next review should be now or future")
        }
    }

    // MARK: - Progress Calculation Tests

    @MainActor
    func testProgressCalculation() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        // Create 10 cards, mark 5 as reviewed
        for i in 1...10 {
            let card = Flashcard(
                question: "Question \(i)",
                answer: "Answer \(i)",
                deck: deck
            )
            context.insert(card)

            // Add review sessions to first 5 cards
            if i <= 5 {
                let session = ReviewSession(
                    difficulty: 3,
                    easeFactor: 2.5,
                    interval: 1440,
                    nextReview: Date().addingTimeInterval(86400),
                    flashcard: card
                )
                context.insert(session)
            }
        }
        try context.save()

        // Calculate progress
        let cards = deck.flashcards ?? []
        let reviewedCards = cards.filter { !($0.reviewSessions?.isEmpty ?? true) }
        let progress = Double(reviewedCards.count) / Double(cards.count)

        XCTAssertEqual(cards.count, 10, "Should have 10 cards")
        XCTAssertEqual(reviewedCards.count, 5, "Should have 5 reviewed cards")
        XCTAssertEqual(progress, 0.5, accuracy: 0.01, "Progress should be 50%")
    }

    // MARK: - Deck Silencing Tests

    @MainActor
    func testDeckSilencing() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)
        try context.save()

        // Initially not silenced
        XCTAssertFalse(deck.isSilenced)
        XCTAssertFalse(deck.isCurrentlySilenced)

        // Test permanent silence
        deck.silencePermanently()
        XCTAssertTrue(deck.isSilenced)
        XCTAssertEqual(deck.silenceType, "permanent")
        XCTAssertTrue(deck.isCurrentlySilenced)

        // Test unsilence
        deck.unsilence()
        XCTAssertFalse(deck.isSilenced)
        XCTAssertNil(deck.silenceType)
        XCTAssertFalse(deck.isCurrentlySilenced)

        // Test temporary silence
        let futureDate = Date().addingTimeInterval(3600) // 1 hour from now
        deck.silenceTemporarily(until: futureDate)
        XCTAssertTrue(deck.isSilenced)
        XCTAssertEqual(deck.silenceType, "temporary")
        XCTAssertEqual(deck.silenceEndDate, futureDate)
        XCTAssertTrue(deck.isCurrentlySilenced)
    }

    @MainActor
    func testTemporarySilenceExpiry() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        // Silence until a time in the past (simulating expiry)
        let pastDate = Date().addingTimeInterval(-3600) // 1 hour ago
        deck.silenceTemporarily(until: pastDate)

        XCTAssertTrue(deck.isSilenced, "isSilenced flag should still be true")

        // Check and update expired silences
        deck.checkAndUpdateSilenceExpiry()

        XCTAssertFalse(deck.isSilenced, "Should be unsilenced after expiry check")
        XCTAssertFalse(deck.isCurrentlySilenced)
    }

    // MARK: - View State Tests

    @MainActor
    func testDeckDetailViewState() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        // Create some cards with different creation times
        for i in 1...5 {
            let card = Flashcard(
                question: "Question \(i)",
                answer: "Answer \(i)",
                createdAt: Date().addingTimeInterval(Double(-i * 60)), // Staggered creation
                deck: deck
            )
            context.insert(card)
        }
        try context.save()

        // Test filtered cards logic (similar to DeckDetailView)
        let cards = deck.flashcards ?? []
        let sortedCards = cards.sorted { ($0.createdAt) > ($1.createdAt) }

        XCTAssertEqual(sortedCards.count, 5, "Should have 5 cards")
        // First card should be most recently created (smallest negative offset)
        XCTAssertEqual(sortedCards.first?.question, "Question 1")
    }

    // MARK: - Navigation Tests

    @MainActor
    func testNavigationPaths() throws {
        // Test that all required navigation destinations can be instantiated
        let deck = Deck(name: "Test Deck")
        context.insert(deck)
        try context.save()

        // These should not crash - basic instantiation test
        XCTAssertNoThrow(DeckDetailView(deck: deck))
        XCTAssertNoThrow(AddCardView(deck: deck))
        XCTAssertNoThrow(EditDeckView(deck: deck))
    }

    // MARK: - Data Integrity Tests

    @MainActor
    func testDataIntegrity() throws {
        let deck = Deck(name: "Test Deck")
        context.insert(deck)

        let card = Flashcard(question: "Test Question", answer: "Test Answer", deck: deck)
        context.insert(card)

        let session = ReviewSession(
            difficulty: 2,
            easeFactor: 2.5,
            interval: 1440,
            flashcard: card
        )
        context.insert(session)
        try context.save()

        // Verify relationships
        XCTAssertEqual(card.deck, deck)
        XCTAssertTrue(deck.flashcards?.contains(card) ?? false)
        XCTAssertEqual(session.flashcard, card)
        XCTAssertTrue(card.reviewSessions?.contains(session) ?? false)

        // Store IDs for verification after deletion
        let cardId = card.id
        let sessionId = session.id

        // Delete deck - should cascade to cards and sessions
        context.delete(deck)
        try context.save()

        // Verify card was deleted (cascade from deck)
        let cardDescriptor = FetchDescriptor<Flashcard>(
            predicate: #Predicate { $0.id == cardId }
        )
        let remainingCards = try context.fetch(cardDescriptor)
        XCTAssertEqual(remainingCards.count, 0, "Card should be deleted when deck is deleted (cascade)")

        // Verify session was deleted (cascade from card)
        let sessionDescriptor = FetchDescriptor<ReviewSession>(
            predicate: #Predicate { $0.id == sessionId }
        )
        let remainingSessions = try context.fetch(sessionDescriptor)
        XCTAssertEqual(remainingSessions.count, 0, "Session should be deleted when card is deleted (cascade)")
    }

    @MainActor
    func testFlashcardWithoutDeck() throws {
        // Cards can exist without a deck
        let card = Flashcard(question: "Standalone", answer: "Card")
        context.insert(card)
        try context.save()

        XCTAssertNil(card.deck, "Card without deck should have nil deck")
        XCTAssertNotNil(card.id)
        XCTAssertEqual(card.question, "Standalone")
    }

    // MARK: - Review Mode Tests

    @MainActor
    func testReviewModeSettings() throws {
        let service = SpacedRepetitionService.shared

        // Test default mode
        let originalMode = service.currentReviewMode

        // Test setting different modes
        service.currentReviewMode = .normal
        XCTAssertEqual(service.currentReviewMode, .normal)

        service.currentReviewMode = .practice
        XCTAssertEqual(service.currentReviewMode, .practice)

        service.currentReviewMode = .cram
        XCTAssertEqual(service.currentReviewMode, .cram)

        // Restore original
        service.currentReviewMode = originalMode
    }

    // MARK: - Performance Tests

    @MainActor
    func testPerformanceCreating1000Cards() throws {
        measure {
            let deck = Deck(name: "Performance Test")
            context.insert(deck)

            for i in 1...1000 {
                let card = Flashcard(
                    question: "Question \(i)",
                    answer: "Answer \(i)",
                    deck: deck
                )
                context.insert(card)
            }

            try! context.save()
        }
    }

    @MainActor
    func testPerformanceFetchingCards() throws {
        // Setup: Create a deck with 500 cards
        let deck = Deck(name: "Fetch Performance Test")
        context.insert(deck)

        for i in 1...500 {
            let card = Flashcard(
                question: "Question \(i)",
                answer: "Answer \(i)",
                deck: deck
            )
            context.insert(card)
        }
        try context.save()

        // Measure fetch performance
        measure {
            let descriptor = FetchDescriptor<Flashcard>()
            let _ = try! context.fetch(descriptor)
        }
    }
}
