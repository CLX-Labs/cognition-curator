# Cognition Curator - Architecture Documentation

## Directory Structure

```
cognition-curator/
├── CLAUDE.md                          # Claude Code rules (AI assistant guide)
├── cognition.curator/
│   ├── ARCHITECTURE.md                # This file
│   ├── KNOWN_ISSUES.md                # Bug tracking and known issues
│   │
│   ├── cognition.curator/             # Main app target
│   │   ├── cognition_curatorApp.swift # App entry point
│   │   ├── ContentView.swift          # Main tab navigation
│   │   ├── PersistenceController.swift # SwiftData setup
│   │   │
│   │   ├── Models/                    # SwiftData models
│   │   │   ├── Deck.swift
│   │   │   ├── Flashcard.swift
│   │   │   ├── ReviewSession.swift
│   │   │   ├── User.swift
│   │   │   ├── SyncOperation.swift
│   │   │   ├── OnboardingModels.swift
│   │   │   ├── CodableHelpers.swift
│   │   │   └── DeckExtensions.swift
│   │   │
│   │   ├── Services/                  # Business logic singletons
│   │   │   ├── AuthenticationService.swift
│   │   │   ├── SpacedRepetitionService.swift
│   │   │   ├── DeckAPIService.swift
│   │   │   ├── FlashcardAPIService.swift
│   │   │   ├── AIGenerationService.swift
│   │   │   ├── APIConfiguration.swift
│   │   │   ├── WidgetDataService.swift
│   │   │   ├── DeepLinkHandler.swift
│   │   │   ├── ProgressDataService.swift
│   │   │   ├── OfflineSyncService.swift
│   │   │   ├── OfflineProgressService.swift
│   │   │   ├── AnalyticsAPIService.swift
│   │   │   ├── SubscriptionService.swift
│   │   │   └── NetworkMonitor.swift
│   │   │
│   │   ├── Views/                     # SwiftUI views
│   │   │   ├── HomeView.swift
│   │   │   ├── ReviewView.swift
│   │   │   ├── DecksView.swift
│   │   │   ├── ProgressStatsView.swift
│   │   │   ├── CreateDeckView.swift
│   │   │   ├── AddCardView.swift
│   │   │   ├── DeckDetailView.swift
│   │   │   ├── EditDeckView.swift
│   │   │   ├── DeckRowView.swift
│   │   │   ├── OnboardingView.swift
│   │   │   ├── AppleOnlyAuthView.swift
│   │   │   ├── ProfileView.swift
│   │   │   ├── SettingsView.swift
│   │   │   ├── DeckSelectorView.swift
│   │   │   ├── DeckSilenceView.swift
│   │   │   ├── AICardReviewView.swift
│   │   │   ├── AIAnswerReviewView.swift
│   │   │   ├── AppleSignInButton.swift
│   │   │   └── PremiumRequiredView.swift
│   │   │
│   │   ├── Utils/                     # Helper extensions
│   │   │   ├── DateFormatter+Extensions.swift
│   │   │   ├── ExpandableText.swift
│   │   │   └── ToastView.swift
│   │   │
│   │   └── Preview Content/
│   │       └── PreviewHelper.swift
│   │
│   ├── CognitionCuratorWidget/        # Widget extension target
│   │   ├── CognitionCuratorWidget.swift
│   │   ├── CognitionCuratorWidgetControl.swift
│   │   ├── CognitionCuratorWidgetBundle.swift
│   │   └── CognitionCuratorWidgetExtension.entitlements
│   │
│   └── cognition.curator.xcodeproj/   # Xcode project
```

---

## Architecture Pattern: MVVM + Services

### Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                              VIEWS                                      │
│   SwiftUI Views observe state and trigger actions                       │
│   HomeView, ReviewView, DecksView, ProgressStatsView, etc.             │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│          SERVICES             │   │          VIEW MODELS              │
│   Singleton business logic    │   │   View-specific state (optional)  │
│   AuthService, DeckAPI, etc.  │   │   Computed from Services          │
└───────────────────────────────┘   └───────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              MODELS                                     │
│   SwiftData @Model classes for persistence                              │
│   Deck, Flashcard, ReviewSession, User                                 │
└────────────────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────────┐   ┌───────────────────┐
│    SwiftData      │   │   Backend API     │
│   Local Storage   │   │   Flask/Railway   │
└───────────────────┘   └───────────────────┘
```

### Key Principles

1. **Services are Singletons**: All services use `static let shared` pattern
2. **Views Observe Services**: Via `@StateObject`, `@EnvironmentObject`, or direct access
3. **Models are SwiftData**: Using `@Model` macro for automatic persistence
4. **Async/Await**: All network operations use modern Swift concurrency

---

## Data Flow Diagrams

### Authentication Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User      │     │  AuthService     │     │  Backend API    │
│   Action    │     │  (Singleton)     │     │  /auth/*        │
└──────┬──────┘     └────────┬─────────┘     └────────┬────────┘
       │                     │                        │
       │  Tap Sign In        │                        │
       │────────────────────>│                        │
       │                     │                        │
       │                     │  Apple Auth Sheet      │
       │                     │◄───────────────────────│
       │                     │                        │
       │                     │  Identity Token        │
       │                     │────────────────────────>
       │                     │                        │
       │                     │  JWT Access Token      │
       │                     │<────────────────────────
       │                     │                        │
       │                     │  Save to UserDefaults  │
       │                     │  Update authState      │
       │                     │                        │
       │  Authenticated      │                        │
       │<────────────────────│                        │
```

### Widget Data Flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   Main App      │     │  WidgetDataService   │     │  Widget Extension│
│                 │     │                      │     │                  │
└────────┬────────┘     └──────────┬───────────┘     └────────┬─────────┘
         │                         │                          │
         │  User completes review  │                          │
         │─────────────────────────>                          │
         │                         │                          │
         │                         │  Query SwiftData         │
         │                         │  (due cards, top card)   │
         │                         │                          │
         │                         │  Write to App Groups     │
         │                         │  UserDefaults            │
         │                         │                          │
         │                         │  synchronize()           │
         │                         │                          │
         │                         │  reloadAllTimelines()    │
         │                         │─────────────────────────>│
         │                         │                          │
         │                         │                          │  Read App Groups
         │                         │                          │  UserDefaults
         │                         │                          │
         │                         │                          │  Update UI
```

### API Sync Flow

```
┌────────────┐     ┌───────────────┐     ┌───────────────┐     ┌──────────┐
│   View     │     │  API Service  │     │  AuthService  │     │ Backend  │
└─────┬──────┘     └───────┬───────┘     └───────┬───────┘     └────┬─────┘
      │                    │                     │                   │
      │  Create Deck       │                     │                   │
      │───────────────────>│                     │                   │
      │                    │                     │                   │
      │                    │  getJWTToken()      │                   │
      │                    │────────────────────>│                   │
      │                    │                     │                   │
      │                    │  Check expiration   │                   │
      │                    │<────────────────────│                   │
      │                    │                     │                   │
      │                    │  POST /decks        │                   │
      │                    │  Authorization:     │                   │
      │                    │  Bearer {token}     │                   │
      │                    │──────────────────────────────────────────>
      │                    │                     │                   │
      │                    │  201 Created        │                   │
      │                    │<──────────────────────────────────────────
      │                    │                     │                   │
      │  Success           │                     │                   │
      │<───────────────────│                     │                   │
```

---

## Service Dependencies

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AuthenticationService                         │
│  - JWT token management                                              │
│  - Apple Sign-In                                                     │
│  - Session state                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌───────────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
│   DeckAPIService      │ │FlashcardAPIServ │ │AnalyticsAPIService   │
│   - CRUD decks        │ │ - CRUD cards    │ │ - Study stats        │
│   - Requires JWT      │ │ - Batch create  │ │ - Dashboard data     │
└───────────────────────┘ └─────────────────┘ └──────────────────────┘
                    │               │
                    └───────┬───────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SpacedRepetitionService                         │
│  - SM-2 algorithm                                                    │
│  - Due card calculations                                             │
│  - Deck silence management                                           │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WidgetDataService                             │
│  - App Groups data sharing                                           │
│  - Widget refresh triggers                                           │
│  - Due count & top card                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## SwiftData Model Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Deck                                    │
│  @Model                                                              │
│  ├── id: UUID                                                        │
│  ├── name: String                                                    │
│  ├── createdAt: Date                                                 │
│  ├── isPremium: Bool                                                 │
│  ├── isSuperset: Bool                                                │
│  ├── isSilenced: Bool                                                │
│  ├── silenceEndDate: Date?                                           │
│  └── flashcards: [Flashcard]?  ───────────────────┐                  │
└─────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ @Relationship
                                                    │ (deleteRule: .cascade)
                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            Flashcard                                 │
│  @Model                                                              │
│  ├── id: UUID                                                        │
│  ├── question: String                                                │
│  ├── answer: String                                                  │
│  ├── createdAt: Date                                                 │
│  ├── deck: Deck?                                                     │
│  └── reviewSessions: [ReviewSession]?  ───────────┐                  │
└─────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ @Relationship
                                                    │ (deleteRule: .cascade)
                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          ReviewSession                               │
│  @Model                                                              │
│  ├── id: UUID                                                        │
│  ├── reviewedAt: Date                                                │
│  ├── difficulty: Int          (0=Again, 1=Hard, 2=Good, 3=Easy)     │
│  ├── easeFactor: Double       (SM-2 ease, default 2.5)              │
│  ├── interval: Int            (days until next review)               │
│  ├── nextReview: Date         (when card is due)                     │
│  └── flashcard: Flashcard?                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Widget Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CognitionCuratorWidgetBundle                      │
│  - Entry point for widget extension                                  │
│  - Registers CognitionCuratorWidget + Control                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│   CognitionCuratorWidget      │       │ CognitionCuratorWidgetControl │
│   - Home screen widget        │       │ - Control center widget       │
│   - Shows next due card       │       │ - Shows due count badge       │
│   - Deep links to app         │       │                               │
└───────────────────────────────┘       └───────────────────────────────┘
            │                                               │
            └───────────────────────┬───────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        App Groups Storage                            │
│  UserDefaults(suiteName: "group.collect.software.cognition-curator")│
│                                                                      │
│  Keys:                                                               │
│  - widget.dueCardsCount: Int                                         │
│  - widget.hasCards: Bool                                             │
│  - widget.lastUpdated: Date                                          │
│  - widget.topCard.hasContent: Bool                                   │
│  - widget.topCard.question: String                                   │
│  - widget.topCard.answer: String                                     │
│  - widget.topCard.deckName: String                                   │
│  - widget.topCard.cardId: String                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Refresh Timeline

```
Widget Refresh Schedule:
┌─────────────────────────────────────────────────────────────────────┐
│  If widget has card content:                                         │
│    Next refresh = current time + 15 minutes                          │
│                                                                      │
│  If no cards available:                                              │
│    Next refresh = current time + 30 minutes                          │
│                                                                      │
│  Additional refreshes triggered by:                                  │
│    - App launch                                                      │
│    - Review completion                                               │
│    - Card addition                                                   │
│    - App becomes active                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Base URLs
```
Development: http://127.0.0.1:5001/api
Production:  https://cognition-curator-production.up.railway.app/api
```

### Authentication
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/apple-signin` | Exchange Apple identity token for JWT |
| GET | `/auth/profile` | Validate JWT and get user profile |
| POST | `/auth/refresh` | Refresh expired JWT token |

### Decks
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/decks/` | List all user decks |
| POST | `/decks/` | Create new deck |
| DELETE | `/decks/{id}` | Delete deck |

### Flashcards
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/flashcards/deck/{deckId}` | Get cards for deck |
| POST | `/flashcards/` | Create single card |
| POST | `/flashcards/batch` | Batch create cards |
| DELETE | `/flashcards/{id}` | Delete card |

### AI
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/ai/generate-flashcards` | Generate cards from topic |
| POST | `/ai/generate-answer` | Generate answer for question |

### Analytics
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/analytics/dashboard` | Get study statistics |
| POST | `/sync/study-session` | Sync review session |
| POST | `/sync/flashcard-review` | Sync individual review |

---

## Timeout Configuration

```swift
// APIConfiguration.swift

static let defaultTimeoutInterval: TimeInterval = 60    // Standard requests
static let authTimeoutInterval: TimeInterval = 120      // Auth (cold start)
static let aiTimeoutInterval: TimeInterval = 180        // AI generation

// Custom URLSessions
static let authURLSession: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = authTimeoutInterval
    config.timeoutIntervalForResource = authTimeoutInterval
    return URLSession(configuration: config)
}()

static let aiURLSession: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = aiTimeoutInterval
    config.timeoutIntervalForResource = aiTimeoutInterval
    return URLSession(configuration: config)
}()
```

---

## Deep Linking

### URL Scheme
```
cognitioncurator://
```

### Supported Paths
| URL | Action |
|-----|--------|
| `cognitioncurator://review` | Open Review tab |
| `cognitioncurator://review/{cardId}` | Open specific card for review |

### Handler
```swift
// DeepLinkHandler.swift
class DeepLinkHandler: ObservableObject {
    @Published var pendingCardId: String?
    @Published var shouldNavigateToReview: Bool = false

    func handle(url: URL) {
        // Parse URL and set published properties
        // ContentView observes and navigates accordingly
    }
}
```

---

## Error Handling Patterns

### API Errors
```swift
enum APIError: Error {
    case notAuthenticated       // No JWT token
    case sessionExpired         // 401 from backend
    case serverError(Int, String)
    case networkError(Error)
    case decodingError(Error)
}
```

### Response Handling
```swift
func handleAPIResponse(_ response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse else {
        throw APIError.networkError(URLError(.badServerResponse))
    }

    switch http.statusCode {
    case 200...299: return
    case 401: throw APIError.sessionExpired
    default: throw APIError.serverError(http.statusCode, String(data: data, encoding: .utf8) ?? "")
    }
}
```

### Logging Convention
```swift
print("✅ Success message")
print("⚠️ Warning message")
print("❌ Error message")
print("🔄 In-progress message")
print("📱 Widget-related message")
print("🔐 Auth-related message")
```
