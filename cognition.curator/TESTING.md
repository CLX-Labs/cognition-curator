# Cognition Curator - Testing Guide

This document provides guidance for running and writing tests for the Cognition Curator iOS app.

---

## Quick Start

### Run All Tests
```bash
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  2>&1 | xcpretty
```

### Run Unit Tests Only
```bash
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:cognition.curatorTests
```

### Run UI Tests Only
```bash
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:cognition.curatorUITests
```

---

## Test Architecture

### Test Targets

| Target | Type | Purpose |
|--------|------|---------|
| `cognition.curatorTests` | Unit Tests | Model creation, service logic, algorithms |
| `cognition.curatorUITests` | UI Tests | App launch, navigation flows |

### SwiftData Testing Pattern

The app uses **SwiftData** (not CoreData). Tests use an **in-memory ModelContainer** for isolation:

```swift
import XCTest
import SwiftData
@testable import cognition_curator

final class MyTests: XCTestCase {
    var container: ModelContainer!
    var context: ModelContext!

    @MainActor
    override func setUpWithError() throws {
        let schema = Schema([Deck.self, Flashcard.self, ReviewSession.self, User.self, SyncOperation.self])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        container = try ModelContainer(for: schema, configurations: [config])
        context = container.mainContext
    }

    override func tearDownWithError() throws {
        container = nil
        context = nil
    }
}
```

### Key Testing Requirements

1. **@MainActor**: All SwiftData operations must be on the main actor
2. **In-Memory Container**: Use `isStoredInMemoryOnly: true` for test isolation
3. **Context Insert**: Always `context.insert(model)` before assertions
4. **Save Before Fetch**: Call `try context.save()` before querying relationships

---

## Model Initializers (For Test Writing)

### Deck
```swift
Deck(
    id: UUID = UUID(),
    name: String,                    // REQUIRED
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
    lastSyncedAt: Date? = nil
)
```

### Flashcard
```swift
Flashcard(
    id: UUID = UUID(),
    question: String,                // REQUIRED
    answer: String,                  // REQUIRED
    createdAt: Date = Date(),
    updatedAt: Date? = nil,
    metadata: [String: AnyCodable]? = nil,
    syncStatus: String = "synced",
    needsSync: Bool = false,
    lastSyncedAt: Date? = nil,
    deck: Deck? = nil
)
```

### ReviewSession
```swift
ReviewSession(
    id: UUID = UUID(),
    difficulty: Int16,               // REQUIRED (0=Again, 1=Hard, 2=Good, 3=Easy)
    easeFactor: Double,              // REQUIRED (default 2.5, min 1.3)
    interval: Double,                // REQUIRED (minutes)
    reviewedAt: Date = Date(),
    nextReview: Date? = nil,
    syncStatus: String = "pending",
    needsSync: Bool = true,
    lastSyncedAt: Date? = nil,
    flashcard: Flashcard? = nil
)
```

---

## Test Categories

### Unit Tests (`cognition_curatorTests.swift`)

| Test | Description |
|------|-------------|
| `testDeckCreation` | Deck model instantiation and defaults |
| `testFlashcardCreation` | Flashcard with deck relationship |
| `testReviewSessionCreation` | ReviewSession with flashcard link |
| `testSpacedRepetitionCalculation` | SM-2 algorithm produces future dates |
| `testSpacedRepetitionDifficultyLevels` | All difficulty levels (0-3) work |
| `testProgressCalculation` | Review progress percentage math |
| `testDeckSilencing` | Permanent and temporary silence |
| `testTemporarySilenceExpiry` | Expired silence auto-unsilences |
| `testDeckDetailViewState` | View state with sorted cards |
| `testNavigationPaths` | Views instantiate without crash |
| `testDataIntegrity` | Cascade delete rules work |
| `testFlashcardWithoutDeck` | Standalone cards allowed |
| `testReviewModeSettings` | Normal, Practice, Cram modes |
| `testPerformanceCreating1000Cards` | Performance benchmark |
| `testPerformanceFetchingCards` | Fetch performance benchmark |

### UI Tests

| Test | Description |
|------|-------------|
| `testLaunch` | App launches successfully |
| `testLaunchPerformance` | Launch performance measurement |

---

## Adding New Tests

### 1. Create Test Method

```swift
@MainActor
func testMyFeature() throws {
    // Arrange: Create models
    let deck = Deck(name: "Test")
    context.insert(deck)
    try context.save()

    // Act: Perform operation
    deck.silencePermanently()

    // Assert: Verify results
    XCTAssertTrue(deck.isSilenced)
}
```

### 2. Testing Services

When testing services that need a context:

```swift
@MainActor
func testServiceMethod() throws {
    let deck = Deck(name: "Test")
    let card = Flashcard(question: "Q", answer: "A", deck: deck)
    context.insert(deck)
    context.insert(card)
    try context.save()

    // Service methods may need context parameter
    let result = SpacedRepetitionService.shared.calculateNextReview(
        for: card,
        difficulty: 3,
        context: context
    )

    XCTAssertTrue(result > Date())
}
```

### 3. Testing Relationships

```swift
@MainActor
func testRelationships() throws {
    let deck = Deck(name: "Test")
    context.insert(deck)

    let card = Flashcard(question: "Q", answer: "A", deck: deck)
    context.insert(card)
    try context.save()

    // Test both directions of relationship
    XCTAssertEqual(card.deck, deck)
    XCTAssertTrue(deck.flashcards?.contains(card) ?? false)
}
```

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `extra argument 'context' in call` | Using CoreData pattern | Use SwiftData initializers (no context param) |
| `@MainActor function cannot be called from non-isolated context` | Missing @MainActor | Add `@MainActor` to test method |
| `Relationship is nil` | Forgot to save | Call `try context.save()` after insert |
| `Cannot find 'FetchDescriptor' in scope` | Missing import | Add `import SwiftData` |

### Simulator Issues

If tests fail to start:
```bash
# Reset simulator
xcrun simctl shutdown all
xcrun simctl erase all

# Or use a specific device
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=17.0'
```

---

## Before Submitting Changes

**Always run tests before creating a PR:**

```bash
# Quick test run
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:cognition.curatorTests 2>&1 | xcpretty

# Full test suite
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | xcpretty
```

Expected result: **All tests pass**

---

## CI/CD Notes

For automated testing pipelines:

```bash
# Headless test execution
xcodebuild test \
  -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -resultBundlePath TestResults.xcresult \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO
```

---

## Test File Locations

```
cognition.curator/
├── cognition.curatorTests/
│   └── cognition_curatorTests.swift    # Unit tests
├── cognition.curatorUITests/
│   ├── cognition_curatorUITests.swift  # UI tests
│   └── cognition_curatorUITestsLaunchTests.swift
```
