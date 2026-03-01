# Cognition Curator - Known Issues & Bug Fixes

This document tracks discovered bugs, their root causes, and fixes applied.

---

## Issue Summary

| ID | Severity | Status | Issue |
|----|----------|--------|-------|
| W1 | HIGH | FIXED | Widget race condition - reload before data write |
| W2 | MEDIUM | FIXED | Silent fallback when App Group unavailable |
| W3 | MEDIUM | FIXED | Widget control missing error state |
| W4 | LOW | FIXED | Deep link card validation missing |
| A1 | CRITICAL | FIXED | No JWT token expiration tracking |
| A2 | HIGH | FIXED | No 401 error handling in API services |
| A3 | MEDIUM | FIXED | No periodic token validation |
| A4 | MEDIUM | FIXED | Failed auth restoration signs user out immediately |

---

## Widget Issues

### W1: Race Condition in Widget Reload (HIGH)

**File**: `Services/WidgetDataService.swift`

**Root Cause**: Two separate `Task` blocks run independently. The first writes data to UserDefaults, the second (with a delay) triggers widget reload. Since they're independent tasks, the reload can happen before the data write completes.

**Original Code** (lines 46-112):
```swift
// Task 1: Write data
Task { @MainActor in
    let counts = getDueCardCounts()
    let topCard = getTopReviewCard()
    // ... write to sharedDefaults ...
    self.sharedDefaults.synchronize()
}

// Task 2: Reload widget (runs independently!)
Task { @MainActor in
    try? await Task.sleep(nanoseconds: 100_000_000)
    WidgetCenter.shared.reloadAllTimelines()
}
```

**Fix**: Consolidate into single async function with proper sequential execution:
```swift
func updateWidgetData() async {
    // Write data first
    await MainActor.run {
        let counts = getDueCardCounts()
        let topCard = getTopReviewCard()
        // ... write to sharedDefaults ...
        sharedDefaults.synchronize()
    }

    // Small delay for filesystem sync
    try? await Task.sleep(nanoseconds: 100_000_000)

    // Now safe to reload
    await MainActor.run {
        WidgetCenter.shared.reloadAllTimelines()
        WidgetCenter.shared.reloadTimelines(ofKind: "CognitionCuratorWidget")
    }
}
```

**Impact**: Widget could display stale or incomplete data.

**Verification**: Add flashcard, verify widget updates correctly within seconds.

---

### W2: Silent App Group Fallback (MEDIUM)

**File**: `Services/WidgetDataService.swift`

**Root Cause**: When App Group is unavailable, the service silently falls back to `UserDefaults.standard`, which isn't shared with the widget. No warning is logged, and updates continue to the wrong storage.

**Original Code** (lines 26-38):
```swift
private init() {
    if let defaults = UserDefaults(suiteName: appGroupId) {
        self.sharedDefaults = defaults
        self.isAppGroupAvailable = true
    } else {
        self.sharedDefaults = UserDefaults.standard  // Silent fallback
        self.isAppGroupAvailable = false
    }
}
```

**Fix**: Add logging and guard against updates when unavailable:
```swift
private init() {
    if let defaults = UserDefaults(suiteName: appGroupId) {
        self.sharedDefaults = defaults
        self.isAppGroupAvailable = true
        print("✅ WidgetDataService: App Group available")
    } else {
        print("❌ CRITICAL: App Group '\(appGroupId)' not available - widget data sharing disabled")
        self.sharedDefaults = UserDefaults.standard
        self.isAppGroupAvailable = false
    }
}

func updateWidgetData() async {
    guard isAppGroupAvailable else {
        print("⚠️ Widget data update skipped - App Group not available")
        return
    }
    // ... rest of function
}
```

**Impact**: Widget shows "Configuration Error" or stale data with no developer awareness.

**Verification**: Check console for App Group status on app launch.

---

### W3: Widget Control Missing Error State (MEDIUM)

**File**: `CognitionCuratorWidget/CognitionCuratorWidgetControl.swift`

**Root Cause**: The control widget uses `?? UserDefaults.standard` fallback which doesn't share data with the main app. Should return safe default instead.

**Original Code** (lines 53-62):
```swift
private func getDueCardsCount() -> ReviewData {
    let sharedDefaults = UserDefaults(suiteName: "group.collect.software.cognition-curator")
                            ?? UserDefaults.standard  // Broken fallback!
    // ... existing logic
}
```

**Fix**: Return safe default state:
```swift
private func getDueCardsCount() -> ReviewData {
    guard let sharedDefaults = UserDefaults(suiteName: "group.collect.software.cognition-curator") else {
        return ReviewData(dueCount: 0)  // Safe default
    }
    // ... existing logic
}
```

**Impact**: Control widget shows incorrect data when App Group unavailable.

---

### W4: Deep Link Card Validation (LOW)

**File**: `Services/DeepLinkHandler.swift`, `CognitionCuratorWidget/CognitionCuratorWidget.swift`

**Root Cause**: When user taps widget to open a specific card, the deep link contains a card ID. If that card was deleted between widget render and tap, the app navigates to Review but can't find the card.

**Original Behavior**: Widget links to `cognitioncurator://review/{cardId}` without validation.

**Fix**: Add validation in DeepLinkHandler:
```swift
func handle(url: URL) {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
          components.host == "review" else { return }

    if let cardId = components.path.dropFirst().isEmpty ? nil : String(components.path.dropFirst()) {
        // Store cardId, view will validate existence
        pendingCardId = cardId
    }

    shouldNavigateToReview = true
}

// In ReviewView, validate card exists before showing:
func validatePendingCard(_ cardId: String) -> Flashcard? {
    // Query SwiftData for card
    // Return nil if not found, show appropriate message
}
```

**Impact**: User confusion when tapping widget for deleted card.

---

## Authentication Issues

### A1: No JWT Token Expiration Tracking (CRITICAL)

**File**: `Services/AuthenticationService.swift`

**Root Cause**: JWT tokens are saved to UserDefaults, but their expiration time is never extracted or stored. The app has no way to know when a token expires until an API call returns 401.

**Missing Functionality**:
1. JWT payload decoding to extract `exp` claim
2. Expiration timestamp storage
3. Pre-API-call expiration check
4. Automatic token refresh

**Fix Implementation**:

```swift
// 1. Add JWT decoding
private struct JWTClaims: Decodable {
    let exp: TimeInterval
    let iat: TimeInterval?
    let sub: String?
}

private func decodeJWT(_ token: String) -> JWTClaims? {
    let parts = token.split(separator: ".")
    guard parts.count >= 2 else { return nil }

    var payload = String(parts[1])
    // Base64 padding
    while payload.count % 4 != 0 { payload += "=" }

    guard let data = Data(base64Encoded: payload) else { return nil }
    return try? JSONDecoder().decode(JWTClaims.self, from: data)
}

// 2. Store expiration
private let tokenExpirationKey = "jwtTokenExpiration"

func saveJWTToken(_ token: String) {
    UserDefaults.standard.set(token, forKey: jwtTokenKey)

    if let claims = decodeJWT(token) {
        UserDefaults.standard.set(claims.exp, forKey: tokenExpirationKey)
        print("🔐 Token expires at: \(Date(timeIntervalSince1970: claims.exp))")
    }
}

// 3. Check expiration
func isTokenExpired() -> Bool {
    let expiration = UserDefaults.standard.double(forKey: tokenExpirationKey)
    guard expiration > 0 else { return true }

    // 5-minute buffer before actual expiration
    return Date().timeIntervalSince1970 > (expiration - 300)
}

// 4. Update token getter
func getCurrentJWTToken() -> String? {
    guard !isTokenExpired() else {
        print("⚠️ Token expired, attempting refresh...")
        Task { await attemptTokenRefresh() }
        return nil
    }
    return UserDefaults.standard.string(forKey: jwtTokenKey)
}

// 5. Add refresh attempt
func attemptTokenRefresh() async {
    // Call /auth/refresh endpoint
    // On success: save new token
    // On failure: sign out user
}
```

**Impact**: Users experience sudden 401 errors with no recovery path.

**Verification**:
1. Sign in and check console for expiration timestamp
2. Manually set past expiration in UserDefaults
3. Verify refresh is attempted

---

### A2: No 401 Error Handling in API Services (HIGH)

**Files**: `DeckAPIService.swift`, `FlashcardAPIService.swift`, `AnalyticsAPIService.swift`, `AIGenerationService.swift`

**Root Cause**: All API services treat 401 (Unauthorized) as a generic server error. When token expires, user sees "Server Error" instead of being signed out.

**Original Pattern**:
```swift
if httpResponse.statusCode == 200 {
    return decoded
} else {
    throw SomeError.serverError(...)  // Includes 401!
}
```

**Fix**: Create shared response handler in `APIConfiguration.swift`:

```swift
// Add to APIConfiguration.swift
enum APIError: Error, LocalizedError {
    case notAuthenticated
    case sessionExpired
    case serverError(Int, String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Not authenticated"
        case .sessionExpired: return "Session expired, please sign in again"
        case .serverError(let code, let msg): return "Server error (\(code)): \(msg)"
        case .networkError(let err): return "Network error: \(err.localizedDescription)"
        case .decodingError(let err): return "Data error: \(err.localizedDescription)"
        }
    }
}

extension Notification.Name {
    static let sessionExpired = Notification.Name("sessionExpired")
}

func handleAPIResponse(_ response: URLResponse, data: Data) throws {
    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.networkError(URLError(.badServerResponse))
    }

    switch httpResponse.statusCode {
    case 200...299:
        return  // Success
    case 401:
        print("🔐 Session expired - 401 received")
        Task { @MainActor in
            await AuthenticationService.shared.signOut()
            NotificationCenter.default.post(name: .sessionExpired, object: nil)
        }
        throw APIError.sessionExpired
    default:
        let message = String(data: data, encoding: .utf8) ?? "Unknown error"
        throw APIError.serverError(httpResponse.statusCode, message)
    }
}
```

**Apply to all services**:
```swift
// Example in DeckAPIService.getDecks()
let (data, response) = try await URLSession.shared.data(for: request)
try handleAPIResponse(response, data: data)
// ... continue with decoding
```

**Impact**: Poor UX - users see generic errors instead of being redirected to sign-in.

---

### A3: No Periodic Token Validation (MEDIUM)

**File**: `cognition_curatorApp.swift`

**Root Cause**: Token is only validated on app launch. If app stays in memory for hours, token can expire without detection until next API call fails.

**Fix**: Add validation on app resume:
```swift
// In cognition_curatorApp.swift body
.onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
    Task {
        if authService.isAuthenticated {
            if authService.isTokenExpired() {
                print("🔐 Token expired on app resume, attempting refresh...")
                await authService.attemptTokenRefresh()
            }
            // Also update widget
            await WidgetDataService.shared.updateWidgetData()
        }
    }
}
```

**Impact**: Long-running sessions may have expired tokens that cause sudden failures.

---

### A4: Failed Auth Restoration Signs User Out Immediately (MEDIUM)

**File**: `Services/AuthenticationService.swift`

**Root Cause**: If backend is temporarily unavailable during app launch (network issue, backend down), the auth restoration fails and signs user out. Should fall back to cached user data for offline use.

**Original Code** (lines 854-862):
```swift
// Neither backend nor local storage worked
print("❌ AuthService: Unable to restore user data, signing out")
await MainActor.run {
    authState = .unauthenticated
    clearJWTToken()
    UserDefaults.standard.removeObject(forKey: userDefaultsKey)
}
```

**Fix**: Distinguish between network errors and actual auth failures:
```swift
private func loadSavedUser() async {
    guard let _ = UserDefaults.standard.string(forKey: jwtTokenKey) else {
        await MainActor.run { authState = .unauthenticated }
        return
    }

    do {
        try await validateJWTToken()
    } catch {
        // Check if it's a network error vs actual auth failure
        if let urlError = error as? URLError,
           urlError.code == .notConnectedToInternet ||
           urlError.code == .timedOut ||
           urlError.code == .cannotConnectToHost {
            print("⚠️ Offline - using cached user data")
            if let cachedUser = loadCachedUser() {
                await MainActor.run {
                    authState = .authenticated(cachedUser)
                }
                return
            }
        }

        // Actual auth failure (401, invalid token)
        if case APIError.sessionExpired = error {
            print("🔐 Token invalid, signing out")
            await signOut()
            return
        }

        // Unknown error - try cached data
        if let cachedUser = loadCachedUser() {
            print("⚠️ Validation failed but using cached user")
            await MainActor.run {
                authState = .authenticated(cachedUser)
            }
        } else {
            await signOut()
        }
    }
}

private func loadCachedUser() -> UserAccount? {
    // Load from UserDefaults cache
    guard let data = UserDefaults.standard.data(forKey: "cachedUserAccount"),
          let user = try? JSONDecoder().decode(UserAccount.self, from: data) else {
        return nil
    }
    return user
}
```

**Impact**: Users are signed out unexpectedly when network is temporarily unavailable.

---

## Verification Checklist

### Widget Fixes
- [ ] W1: Add card → widget updates within seconds (no stale data)
- [ ] W2: Console shows App Group status on launch
- [ ] W3: Control widget shows 0 when App Group unavailable
- [ ] W4: Tapping widget for deleted card shows graceful message

### Auth Fixes
- [ ] A1: Console shows token expiration on sign-in
- [ ] A1: Expired token triggers refresh attempt
- [ ] A2: 401 from any API redirects to sign-in
- [ ] A3: App resume checks token expiration
- [ ] A4: Offline app launch uses cached user

---

## Change Log

| Date | Issue | Action |
|------|-------|--------|
| 2026-02-28 | W1-W4, A1-A4 | Initial discovery and documentation |
| 2026-02-28 | W1 | Fixed race condition - consolidated to single async function in `WidgetDataService.swift` |
| 2026-02-28 | W2 | Fixed silent fallback - added guard and logging in `WidgetDataService.swift` |
| 2026-02-28 | W3 | Fixed widget control - return safe default in `CognitionCuratorWidgetControl.swift` |
| 2026-02-28 | W4 | Fixed deep link validation - added `markCardNotFound()` in `DeepLinkHandler.swift` |
| 2026-02-28 | A1 | Implemented JWT decoding and expiration tracking in `AuthenticationService.swift` |
| 2026-02-28 | A2 | Added `APIError` enum and `handleAPIResponse()` in `APIConfiguration.swift` |
| 2026-02-28 | A3 | Added token expiration check on app resume in `cognition_curatorApp.swift` |
| 2026-02-28 | A4 | Implemented user caching and graceful offline restoration in `AuthenticationService.swift` |
