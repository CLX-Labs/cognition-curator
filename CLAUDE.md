# Cognition Curator - Claude Code Rules

## Project Overview

**Cognition Curator** is an iOS flashcard application that helps users learn and retain information using science-backed spaced repetition (SM-2 algorithm).

### Core Features
- Manual and AI-powered flashcard creation (via LangGraph API)
- Spaced repetition reviews with SM-2 algorithm
- Apple Sign-In authentication with JWT tokens
- Home screen widgets for quick daily reviews
- Progress tracking with streaks and analytics
- Premium features and subscription support
- Backend sync with Flask API

### Tech Stack
- **UI Framework**: SwiftUI
- **Data**: SwiftData with CloudKit support
- **Concurrency**: async/await with Combine
- **Auth**: Apple Sign-In + JWT tokens
- **Backend**: Flask API (`cognition-curator-production.up.railway.app`)
- **Widgets**: WidgetKit with App Groups for data sharing

---

## Architecture

### Pattern: MVVM with Service Singletons

```
┌─────────────────────────────────────────────────────────────┐
│                         Views                                │
│  (SwiftUI Views - HomeView, ReviewView, DecksView, etc.)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Services                              │
│  (Singleton services - AuthService, DeckAPI, WidgetData)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Models                               │
│  (SwiftData @Model - Deck, Flashcard, ReviewSession)        │
└─────────────────────────────────────────────────────────────┘
```

### Service Architecture
- All services are **singletons** accessed via `.shared`
- Services handle business logic and API calls
- Views observe services via `@StateObject` or `@EnvironmentObject`

### Data Flow
1. **Local**: SwiftData for persistence (works offline)
2. **Remote**: Flask backend for sync and AI features
3. **Widget**: App Groups (`group.collect.software.cognition-curator`) for data sharing

---

## Code Conventions

### Swift/SwiftUI Patterns
```swift
// Services are singletons
class MyService {
    static let shared = MyService()
    private init() { }
}

// Use async/await for concurrency
func fetchData() async throws -> Data {
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}

// Models use SwiftData @Model macro
@Model
class Deck {
    var id: UUID
    var name: String
    @Relationship(deleteRule: .cascade) var flashcards: [Flashcard]?
}

// Views follow MVVM pattern
struct MyView: View {
    @StateObject private var viewModel = MyViewModel()
    // ...
}
```

### Naming Conventions
- **Services**: `*Service.swift` (e.g., `AuthenticationService.swift`)
- **Views**: `*View.swift` (e.g., `DeckDetailView.swift`)
- **Models**: Singular nouns (e.g., `Deck.swift`, `Flashcard.swift`)
- **API Services**: `*APIService.swift` (e.g., `DeckAPIService.swift`)

### Error Handling
- Use `do-catch` with specific error types
- Log errors with print statements (using emoji prefixes for visibility)
- Handle 401 errors by signing out user

---

## Key Files to Know

### Entry Points
| File | Purpose |
|------|---------|
| `cognition_curatorApp.swift` | App entry point, auth state management, deep links |
| `ContentView.swift` | Main tab navigation (Home, Decks, Review, Progress) |

### Services (All Singletons)
| File | Purpose |
|------|---------|
| `AuthenticationService.swift` | Apple Sign-In, JWT management, session handling |
| `SpacedRepetitionService.swift` | SM-2 algorithm, due card calculations |
| `DeckAPIService.swift` | Deck CRUD with backend |
| `FlashcardAPIService.swift` | Flashcard CRUD with backend |
| `AIGenerationService.swift` | AI-powered card generation |
| `WidgetDataService.swift` | Widget data sharing via App Groups |
| `APIConfiguration.swift` | Base URLs, timeouts, shared URLSessions |

### Models
| File | Purpose |
|------|---------|
| `Deck.swift` | Flashcard collection with metadata |
| `Flashcard.swift` | Individual study card |
| `ReviewSession.swift` | SM-2 tracking (ease, interval, next review) |
| `OnboardingModels.swift` | Auth states, user account |

### Views (Main)
| File | Purpose |
|------|---------|
| `HomeView.swift` | Dashboard with stats and quick review |
| `ReviewView.swift` | Spaced repetition review interface |
| `DecksView.swift` | Deck list and management |
| `ProgressStatsView.swift` | Learning analytics |
| `AppleOnlyAuthView.swift` | Authentication screen |

### Widget
| File | Purpose |
|------|---------|
| `CognitionCuratorWidget.swift` | Home screen widget implementation |
| `CognitionCuratorWidgetControl.swift` | Control center widget |

---

## Common Tasks

### Adding a New View
1. Create `MyNewView.swift` in `/Views/`
2. Use `@Environment(\.modelContext)` for SwiftData access
3. Inject services via `@EnvironmentObject` or access via `.shared`
4. Add navigation from parent view

### Adding a New API Endpoint
1. Add endpoint path to `APIConfiguration.swift`
2. Create method in appropriate `*APIService.swift`
3. Use `authService.getCurrentJWTToken()` for auth header
4. Handle 401 responses with session expiry logic

### Adding a New Model Property
1. Add property to model in `/Models/`
2. SwiftData handles migration automatically for simple changes
3. Update any API sync methods if property syncs to backend

### Updating Widget Data
1. Call `WidgetDataService.shared.updateWidgetData()` after data changes
2. Widget reads from App Groups UserDefaults
3. Use `WidgetCenter.shared.reloadAllTimelines()` to trigger refresh

---

## API Configuration

### Endpoints
```swift
// Development
let devBaseURL = "http://127.0.0.1:5001/api"

// Production
let prodBaseURL = "https://cognition-curator-production.up.railway.app/api"
```

### Timeouts
| Request Type | Timeout |
|--------------|---------|
| Default | 60 seconds |
| Auth requests | 120 seconds |
| AI generation | 180 seconds |

### Authentication
All API calls require JWT token in header:
```swift
request.setValue("Bearer \(jwtToken)", forHTTPHeaderField: "Authorization")
```

---

## Widget Development

### App Groups
- ID: `group.collect.software.cognition-curator`
- Must be configured in both main app and widget entitlements

### Data Keys
```swift
"widget.dueCardsCount"      // Int: Number of due cards
"widget.hasCards"           // Bool: Any cards exist
"widget.lastUpdated"        // Date: Last sync time
"widget.topCard.hasContent" // Bool: Card data available
"widget.topCard.question"   // String: Card front
"widget.topCard.answer"     // String: Card back
"widget.topCard.deckName"   // String: Parent deck
"widget.topCard.cardId"     // String: UUID for deep linking
```

### Deep Linking
```
cognitioncurator://review         - Opens Review tab
cognitioncurator://review/{cardId} - Opens specific card
```

---

## Authentication Flow

### Sign-In Flow
```
1. User taps "Sign in with Apple"
2. System shows Apple auth sheet
3. On success, extract identity token + authorization code
4. Send to backend: POST /auth/apple-signin
5. Backend returns JWT access token
6. Save token to UserDefaults
7. Transition to authenticated state
```

### Session Restoration (App Launch)
```
1. Check if user ID exists in UserDefaults
2. If found, check for JWT token
3. If token exists, validate with backend: GET /auth/profile
4. On success: restore authenticated state
5. On 401: clear token, sign out
```

### Token Management
- JWT tokens stored in UserDefaults (key: `jwtToken`)
- Token expiration tracked separately (key: `jwtTokenExpiration`)
- 5-minute buffer before expiration triggers refresh
- 401 responses should trigger sign-out

---

## Spaced Repetition (SM-2)

### Algorithm Overview
1. **Learning Phase**: New cards go through 1min → 10min → graduate to review
2. **Review Phase**: Interval multiplied by ease factor (default 2.5)
3. **Difficulty Ratings**: Again (0), Hard (1), Good (2), Easy (3)

### Key Methods
```swift
SpacedRepetitionService.shared.calculateNextReview(
    flashcard: Flashcard,
    difficulty: Int
) -> ReviewSession

SpacedRepetitionService.shared.getDueFlashcards(
    for: [Deck]
) -> [Flashcard]
```

---

## Testing

> **Full documentation**: See `/cognition.curator/TESTING.md` for complete testing guide.

### Running Tests

**Before making any changes, always run the test suite:**

```bash
# Run all tests
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  2>&1 | xcpretty

# Run unit tests only (faster)
xcodebuild test -scheme cognition.curator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:cognition.curatorTests
```

### Test Files

| File | Type | Tests |
|------|------|-------|
| `cognition.curatorTests/cognition_curatorTests.swift` | Unit | 15 tests |
| `cognition.curatorUITests/cognition_curatorUITests.swift` | UI | 2 tests |

### SwiftData Testing Pattern

Tests use **in-memory ModelContainer** for isolation. Key requirements:

1. **@MainActor** - All SwiftData operations must be on main actor
2. **In-memory container** - Use `isStoredInMemoryOnly: true`
3. **Insert before assert** - Always `context.insert(model)` before testing

```swift
@MainActor
func testExample() throws {
    let deck = Deck(name: "Test")
    context.insert(deck)
    try context.save()

    XCTAssertEqual(deck.name, "Test")
}
```

### Test Coverage

| Area | Tests |
|------|-------|
| Model creation | Deck, Flashcard, ReviewSession |
| Spaced repetition | SM-2 calculations, difficulty levels |
| Deck silencing | Permanent, temporary, expiry |
| Data integrity | Cascade delete, relationships |
| Performance | 1000 card creation, fetch speed |

### Before Submitting Changes

1. Run unit tests: `xcodebuild test -scheme cognition.curator -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:cognition.curatorTests`
2. Verify all tests pass
3. If adding new features, add corresponding tests

---

## Manual Testing Checklist

### Authentication
- [ ] Sign in with Apple works
- [ ] Token persists across app restarts
- [ ] 401 response triggers sign-out
- [ ] Offline mode uses cached user

### Widget
- [ ] Widget shows correct due count
- [ ] Widget updates after review
- [ ] Deep link opens correct card
- [ ] Widget handles no cards gracefully

### Review Flow
- [ ] Cards appear in correct order
- [ ] Difficulty rating updates interval
- [ ] Review syncs to backend
- [ ] Silenced decks excluded

---

## Debugging Tips

### Widget Not Updating
1. Check App Group entitlements match in both targets
2. Verify `WidgetDataService.shared.updateWidgetData()` is called
3. Check console for "Widget" prefixed logs
4. Use Settings → Debug → Update Widget Data button

### Auth Issues
1. Check console for "AuthService" prefixed logs
2. Verify JWT token exists: `UserDefaults.standard.string(forKey: "jwtToken")`
3. Check token expiration: `UserDefaults.standard.double(forKey: "jwtTokenExpiration")`
4. Backend health: `GET /api/health`

### API Errors
1. Check network connectivity
2. Verify JWT token is valid and not expired
3. Check backend logs on Railway
4. Use extended timeouts for slow responses
