import Foundation
import SwiftData

// MARK: - Review Mode Configuration
enum ReviewMode: String, CaseIterable {
    case normal = "normal"           // Only due cards
    case practice = "practice"       // Due + recent cards (last 3 days)
    case cram = "cram"               // All cards from selected decks

    var displayName: String {
        switch self {
        case .normal: return "Normal"
        case .practice: return "Practice"
        case .cram: return "Cram"
        }
    }

    var description: String {
        switch self {
        case .normal: return "Review only cards that are due"
        case .practice: return "Practice recently reviewed cards"
        case .cram: return "Review all cards regardless of schedule"
        }
    }

    var isPremium: Bool {
        switch self {
        case .normal: return false
        case .practice: return true
        case .cram: return true
        }
    }
}

// MARK: - Card Learning State
enum CardState: String {
    case new = "new"               // Never reviewed
    case learning = "learning"     // In learning phase with short intervals
    case review = "review"         // Graduated to review phase
    case relearning = "relearning" // Failed review, back to learning
}

class SpacedRepetitionService {
    static let shared = SpacedRepetitionService()

    private init() {}

    // MARK: - Learning Phase Intervals (in minutes)
    private let learningSteps: [Double] = [1, 10] // 1 minute, then 10 minutes
    private let graduationInterval: Double = 1 // 1 day to graduate to review
    private let easyInterval: Double = 4 // 4 days for easy new cards

    // MARK: - Settings
    var currentReviewMode: ReviewMode {
        get {
            let rawValue = UserDefaults.standard.string(forKey: "reviewMode") ?? ReviewMode.normal.rawValue
            return ReviewMode(rawValue: rawValue) ?? .normal
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "reviewMode")
        }
    }

    // Daily card limits - kept low (~5 total) to encourage consistent daily habit
    // Users can review any deck on-demand without these limits
    var maxNewCardsPerDay: Int {
        get { UserDefaults.standard.integer(forKey: "maxNewCardsPerDay") == 0 ? 2 : UserDefaults.standard.integer(forKey: "maxNewCardsPerDay") }
        set { UserDefaults.standard.set(newValue, forKey: "maxNewCardsPerDay") }
    }

    var maxReviewCardsPerDay: Int {
        get { UserDefaults.standard.integer(forKey: "maxReviewCardsPerDay") == 0 ? 3 : UserDefaults.standard.integer(forKey: "maxReviewCardsPerDay") }
        set { UserDefaults.standard.set(newValue, forKey: "maxReviewCardsPerDay") }
    }

    // MARK: - Enhanced SM-2 Algorithm Implementation
    func calculateNextReview(for card: Flashcard, difficulty: Int16, context: ModelContext) -> Date {
        let reviewSessions = card.reviewSessions ?? []
        let sortedSessions = reviewSessions.sorted { ($0.reviewedAt ?? Date()) < ($1.reviewedAt ?? Date()) }

        let cardState = getCardState(card: card)
        let currentStep = getCurrentLearningStep(card: card)

        let newInterval: Double
        let newEaseFactor: Double

        // Get current ease factor from last session or default
        let currentEaseFactor = sortedSessions.last?.easeFactor ?? 2.5

        switch cardState {
        case .new, .learning, .relearning:
            newInterval = handleLearningPhase(difficulty: difficulty, currentStep: currentStep)
            newEaseFactor = currentEaseFactor // Don't change ease factor in learning

        case .review:
            (newInterval, newEaseFactor) = handleReviewPhase(
                difficulty: difficulty,
                currentInterval: sortedSessions.last?.interval ?? 1.0,
                currentEaseFactor: currentEaseFactor
            )
        }

        // Create new review session
        let newSession = ReviewSession(
            difficulty: difficulty,
            easeFactor: newEaseFactor,
            interval: newInterval,
            reviewedAt: Date(),
            flashcard: card
        )

        // Calculate next review date
        if newInterval < 1440 { // Less than 24 hours (in minutes)
            newSession.nextReview = Calendar.current.date(byAdding: .minute, value: Int(newInterval), to: Date())
        } else { // Days
            newSession.nextReview = Calendar.current.date(byAdding: .day, value: Int(newInterval / 1440), to: Date())
        }

        context.insert(newSession)

        return newSession.nextReview ?? Date()
    }

    private func handleLearningPhase(difficulty: Int16, currentStep: Int) -> Double {
        switch difficulty {
        case 0: // Again - restart learning
            return learningSteps[0]
        case 1: // Hard - repeat current step
            return learningSteps[min(currentStep, learningSteps.count - 1)]
        case 2: // Good - advance to next step or graduate
            if currentStep + 1 < learningSteps.count {
                return learningSteps[currentStep + 1]
            } else {
                return graduationInterval * 1440 // Convert to minutes
            }
        case 3: // Easy - skip to easy interval
            return easyInterval * 1440 // Convert to minutes
        default:
            return learningSteps[0]
        }
    }

    private func handleReviewPhase(difficulty: Int16, currentInterval: Double, currentEaseFactor: Double) -> (interval: Double, easeFactor: Double) {
        let newEaseFactor: Double
        let newInterval: Double

        switch difficulty {
        case 0: // Again - back to learning
            newEaseFactor = max(1.3, currentEaseFactor - 0.2)
            newInterval = learningSteps[0]
        case 1: // Hard
            newEaseFactor = max(1.3, currentEaseFactor - 0.15)
            newInterval = max(1, currentInterval * 1.2) * 1440
        case 2: // Good
            newEaseFactor = currentEaseFactor
            newInterval = max(1, currentInterval / 1440 * currentEaseFactor) * 1440
        case 3: // Easy
            newEaseFactor = currentEaseFactor + 0.15
            newInterval = max(1, currentInterval / 1440 * currentEaseFactor * 1.3) * 1440
        default:
            newEaseFactor = currentEaseFactor
            newInterval = currentInterval
        }

        return (newInterval, newEaseFactor)
    }

    private func getCardState(card: Flashcard) -> CardState {
        let reviewSessions = card.reviewSessions ?? []

        guard !reviewSessions.isEmpty else { return .new }

        let sortedSessions = reviewSessions.sorted { ($0.reviewedAt ?? Date()) < ($1.reviewedAt ?? Date()) }
        let lastSession = sortedSessions.last!

        // Check if last answer was "Again" in review phase
        if lastSession.difficulty == 0 && lastSession.interval >= 1440 {
            return .relearning
        }

        // Check if still in learning phase
        if lastSession.interval < 1440 {
            return .learning
        }

        return .review
    }

    private func getCurrentLearningStep(card: Flashcard) -> Int {
        let reviewSessions = card.reviewSessions ?? []
        let learningSessions = reviewSessions.filter { $0.interval < 1440 }
        return learningSessions.count
    }

        // MARK: - Silence Management

    func checkAndUpdateExpiredSilences(context: ModelContext) {
        let now = Date()
        let descriptor = FetchDescriptor<Deck>(
            predicate: #Predicate<Deck> { deck in
                deck.isSilenced == true &&
                deck.silenceType == "temporary" &&
                deck.silenceEndDate != nil &&
                deck.silenceEndDate! <= now
            }
        )

        do {
            let expiredDecks = try context.fetch(descriptor)
            var unsilencedCount = 0

            for deck in expiredDecks {
                deck.unsilence()
                unsilencedCount += 1
                print("🔊 Auto-unsilenced deck: \(deck.name ?? "Unknown") - silence expired")
            }

            if unsilencedCount > 0 {
                try context.save()
                print("✅ Auto-unsilenced \(unsilencedCount) deck(s) with expired temporary silence")
            }
        } catch {
            print("❌ Error checking for expired silences: \(error)")
        }
    }

    // MARK: - Silence Filtering Helper

    private func isDeckSilenced(_ deck: Deck?) -> Bool {
        guard let deck = deck else { return false }
        guard deck.isSilenced else { return false }

        if deck.silenceType == "permanent" {
            return true
        }

        if deck.silenceType == "temporary",
           let endDate = deck.silenceEndDate {
            return Date() < endDate
        }

        return false
    }

    // MARK: - Get Cards for Review (Enhanced)
    func getCardsForTodaySession(context: ModelContext, limit: Int? = nil, force: Bool = false, mode: ReviewMode? = nil) -> [Flashcard] {
        // Check for expired silences before getting cards
        checkAndUpdateExpiredSilences(context: context)

        let reviewMode = mode ?? currentReviewMode
        let actualLimit = limit ?? (reviewMode == .cram ? 50 : 20)

        if force && reviewMode == .normal {
            // Force mode with normal settings - get recent cards
            return getRecentCards(context: context, limit: actualLimit)
        }

        switch reviewMode {
        case .normal:
            return getNormalReviewCards(context: context, limit: actualLimit)
        case .practice:
            return getPracticeCards(context: context, limit: actualLimit)
        case .cram:
            return getCramCards(context: context, limit: actualLimit)
        }
    }

    private func getNormalReviewCards(context: ModelContext, limit: Int) -> [Flashcard] {
        let now = Date()

        // Fetch all cards and filter in memory (SwiftData predicate limitations)
        let descriptor = FetchDescriptor<Flashcard>(
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )

        do {
            let allCards = try context.fetch(descriptor)

            // Filter new cards (no review sessions)
            let newCards = allCards.filter { card in
                (card.reviewSessions?.isEmpty ?? true) && !isDeckSilenced(card.deck)
            }.prefix(min(limit, maxNewCardsPerDay))

            // Filter due cards
            let dueCards = allCards.filter { card in
                guard !isDeckSilenced(card.deck) else { return false }
                guard let sessions = card.reviewSessions, !sessions.isEmpty else { return false }
                return sessions.contains { ($0.nextReview ?? Date()) <= now }
            }

            // Combine: new cards first, then due cards
            var combinedCards: [Flashcard] = Array(newCards)
            for dueCard in dueCards.shuffled() {
                if !combinedCards.contains(where: { $0.id == dueCard.id }) && combinedCards.count < limit {
                    combinedCards.append(dueCard)
                }
            }

            print("📚 Found \(newCards.count) new cards, \(dueCards.count) due cards, returning \(combinedCards.count) total")
            return combinedCards
        } catch {
            print("Error fetching normal review cards: \(error)")
            return []
        }
    }

    private func getPracticeCards(context: ModelContext, limit: Int) -> [Flashcard] {
        let now = Date()
        let threeDaysAgo = Calendar.current.date(byAdding: .day, value: -3, to: now) ?? now

        let descriptor = FetchDescriptor<Flashcard>(
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )

        do {
            let allCards = try context.fetch(descriptor)

            let practiceCards = allCards.filter { card in
                guard !isDeckSilenced(card.deck) else { return false }
                guard let sessions = card.reviewSessions else { return true } // New cards

                // New cards, due cards, or reviewed in last 3 days
                return sessions.isEmpty ||
                       sessions.contains { ($0.nextReview ?? Date()) <= now } ||
                       sessions.contains { ($0.reviewedAt ?? Date()) >= threeDaysAgo }
            }

            let shuffledCards = practiceCards.shuffled().prefix(limit)
            print("📚 Found \(practiceCards.count) practice cards (shuffled)")
            return Array(shuffledCards)
        } catch {
            print("Error fetching practice cards: \(error)")
            return []
        }
    }

    private func getCramCards(context: ModelContext, limit: Int) -> [Flashcard] {
        let descriptor = FetchDescriptor<Flashcard>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )

        do {
            let allCards = try context.fetch(descriptor)
            let cramCards = allCards.filter { card in
                !isDeckSilenced(card.deck)
            }

            let shuffledCards = cramCards.shuffled().prefix(limit)
            print("📚 Found \(cramCards.count) cram cards (shuffled)")
            return Array(shuffledCards)
        } catch {
            print("Error fetching cram cards: \(error)")
            return []
        }
    }

    private func getRecentCards(context: ModelContext, limit: Int) -> [Flashcard] {
        let descriptor = FetchDescriptor<Flashcard>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )

        do {
            let allCards = try context.fetch(descriptor)
            let recentCards = allCards.filter { card in
                !isDeckSilenced(card.deck)
            }

            let shuffledCards = recentCards.shuffled().prefix(limit)
            print("📚 Found \(recentCards.count) recent cards (shuffled)")
            return Array(shuffledCards)
        } catch {
            print("Error fetching recent cards: \(error)")
            return []
        }
    }

    // MARK: - Deck-Specific Review Methods
    func getCardsFromDecks(context: ModelContext, deckIds: [UUID], mode: ReviewMode = .normal, limit: Int = 50, respectSilence: Bool = false) -> [Flashcard] {
        let descriptor = FetchDescriptor<Flashcard>()

        do {
            let allCards = try context.fetch(descriptor)

            // Filter by selected decks
            var deckCards = allCards.filter { card in
                guard let deckId = card.deck?.id else { return false }
                return deckIds.contains(deckId)
            }

            // Optionally respect silence
            if respectSilence {
                deckCards = deckCards.filter { !isDeckSilenced($0.deck) }
            }

            // Apply mode-specific filtering
            let now = Date()
            let threeDaysAgo = Calendar.current.date(byAdding: .day, value: -3, to: now) ?? now

            let filteredCards: [Flashcard]
            switch mode {
            case .normal:
                // Only due and new cards
                filteredCards = deckCards.filter { card in
                    let sessions = card.reviewSessions ?? []
                    return sessions.isEmpty || sessions.contains { ($0.nextReview ?? Date()) <= now }
                }
            case .practice:
                // Due + recent cards (last 3 days)
                filteredCards = deckCards.filter { card in
                    let sessions = card.reviewSessions ?? []
                    return sessions.isEmpty ||
                           sessions.contains { ($0.nextReview ?? Date()) <= now } ||
                           sessions.contains { ($0.reviewedAt ?? Date()) >= threeDaysAgo }
                }
            case .cram:
                // All cards
                filteredCards = deckCards
            }

            let shuffledCards = filteredCards.shuffled().prefix(limit)
            print("📚 Deck review: Found \(filteredCards.count) cards from \(deckIds.count) decks (\(mode.displayName) mode) (shuffled)")
            return Array(shuffledCards)
        } catch {
            print("Error fetching cards from decks: \(error)")
            return []
        }
    }

    func getDeckReviewStats(context: ModelContext, deckIds: [UUID], respectSilence: Bool = false) -> (total: Int, new: Int, due: Int, learning: Int) {
        let now = Date()
        let descriptor = FetchDescriptor<Flashcard>()

        do {
            let allCards = try context.fetch(descriptor)

            // Filter by selected decks
            var deckCards = allCards.filter { card in
                guard let deckId = card.deck?.id else { return false }
                return deckIds.contains(deckId)
            }

            // Optionally respect silence
            if respectSilence {
                deckCards = deckCards.filter { !isDeckSilenced($0.deck) }
            }

            let totalCount = deckCards.count
            let newCount = deckCards.filter { ($0.reviewSessions?.isEmpty ?? true) }.count
            let dueCount = deckCards.filter { card in
                guard let sessions = card.reviewSessions, !sessions.isEmpty else { return false }
                return sessions.contains { ($0.nextReview ?? Date()) <= now }
            }.count
            let learningCount = deckCards.filter { card in
                guard let sessions = card.reviewSessions, !sessions.isEmpty else { return false }
                return sessions.contains { $0.interval < 1440 && ($0.nextReview ?? Date()) <= now }
            }.count

            return (totalCount, newCount, dueCount, learningCount)
        } catch {
            print("Error getting deck review stats: \(error)")
            return (0, 0, 0, 0)
        }
    }

    // MARK: - Legacy Support
    func getCardsDueForReview(context: ModelContext) -> [Flashcard] {
        return getNormalReviewCards(context: context, limit: maxReviewCardsPerDay)
    }

    // MARK: - Calculate Review Statistics
    func calculateReviewStats(for card: Flashcard) -> ReviewStats {
        let reviewSessions = card.reviewSessions ?? []
        let totalReviews = reviewSessions.count
        let correctReviews = reviewSessions.filter { $0.difficulty >= 2 }.count
        let accuracy = totalReviews > 0 ? Double(correctReviews) / Double(totalReviews) : 0.0

        let cardState = getCardState(card: card)
        let nextReview = reviewSessions.sorted { ($0.reviewedAt ?? Date()) < ($1.reviewedAt ?? Date()) }.last?.nextReview

        return ReviewStats(
            totalReviews: totalReviews,
            correctReviews: correctReviews,
            accuracy: accuracy,
            lastReviewed: reviewSessions.last?.reviewedAt,
            nextReview: nextReview,
            cardState: cardState,
            easeFactor: reviewSessions.last?.easeFactor ?? 2.5
        )
    }

    // MARK: - Review Statistics for Home Screen
    func getTodayReviewStats(context: ModelContext) -> (dueCards: Int, newCards: Int, learningCards: Int) {
        let now = Date()
        let descriptor = FetchDescriptor<Flashcard>()

        do {
            let allCards = try context.fetch(descriptor)

            let dueCount = allCards.filter { card in
                guard let sessions = card.reviewSessions, !sessions.isEmpty else { return false }
                return sessions.contains { ($0.nextReview ?? Date()) <= now }
            }.count

            let newCount = allCards.filter { ($0.reviewSessions?.isEmpty ?? true) }.count

            let learningCount = allCards.filter { card in
                guard let sessions = card.reviewSessions, !sessions.isEmpty else { return false }
                return sessions.contains { $0.interval < 1440 && ($0.nextReview ?? Date()) <= now }
            }.count

            return (dueCount, newCount, learningCount)
        } catch {
            print("Error getting today review stats: \(error)")
            return (0, 0, 0)
        }
    }
}

// MARK: - Review Statistics
struct ReviewStats {
    let totalReviews: Int
    let correctReviews: Int
    let accuracy: Double
    let lastReviewed: Date?
    let nextReview: Date?
    let cardState: CardState
    let easeFactor: Double
}

// MARK: - Difficulty Levels
enum DifficultyLevel: Int16, CaseIterable {
    case again = 0
    case hard = 1
    case good = 2
    case easy = 3

    var displayName: String {
        switch self {
        case .again: return "Again"
        case .hard: return "Hard"
        case .good: return "Good"
        case .easy: return "Easy"
        }
    }

    var color: String {
        switch self {
        case .again: return "red"
        case .hard: return "orange"
        case .good: return "green"
        case .easy: return "blue"
        }
    }

    var description: String {
        switch self {
        case .again: return "Incorrect - review again soon"
        case .hard: return "Difficult - extend interval slightly"
        case .good: return "Correct - normal interval"
        case .easy: return "Easy - longer interval"
        }
    }
}
