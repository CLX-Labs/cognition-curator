//
//  cognition_curatorApp.swift
//  cognition.curator
//
//  Created by Nicholas Gattuso on 7/13/25.
//

import SwiftUI
import SwiftData

@main
struct cognition_curatorApp: App {
    let persistenceController = PersistenceController.shared
    @StateObject private var authService = AuthenticationService.shared
    @StateObject private var onboardingState = OnboardingState()
    @StateObject private var deepLinkHandler = DeepLinkHandler()

    // MARK: - Sync Methods

    @MainActor
    private func syncDecksFromBackend() async {
        guard authService.isAuthenticated else {
            print("⚠️ App: Cannot sync decks - user not authenticated")
            return
        }

        print("🔄 App: Starting deck sync from backend...")

        let context = persistenceController.container.mainContext
        let deckAPIService = DeckAPIService(authService: authService)

        do {
            // Fetch decks from backend
            let backendDecks = try await deckAPIService.getDecks()
            print("✅ App: Fetched \(backendDecks.count) decks from backend")

            // Convert and save to local storage
            for backendDeck in backendDecks {
                guard let deckId = UUID(uuidString: backendDeck.id) else {
                    print("⚠️ App: Invalid deck ID: \(backendDeck.id)")
                    continue
                }

                // Check if deck already exists locally
                var descriptor = FetchDescriptor<Deck>(
                    predicate: #Predicate<Deck> { deck in
                        deck.id == deckId
                    }
                )
                descriptor.fetchLimit = 1

                let existingDecks = try? context.fetch(descriptor)

                if let existingDeck = existingDecks?.first {
                    // Update existing deck
                    existingDeck.name = backendDeck.name
                    existingDeck.updatedAt = ISO8601DateFormatter().date(from: backendDeck.updatedAt) ?? Date()
                    existingDeck.syncStatus = "synced"
                    existingDeck.needsSync = false
                    existingDeck.lastSyncedAt = Date()
                    print("✅ App: Updated existing deck: \(backendDeck.name)")
                } else {
                    // Create new deck
                    let dateFormatter = ISO8601DateFormatter()
                    let createdAt = dateFormatter.date(from: backendDeck.createdAt) ?? Date()
                    let updatedAt = dateFormatter.date(from: backendDeck.updatedAt)

                    let newDeck = Deck(
                        id: deckId,
                        name: backendDeck.name,
                        createdAt: createdAt,
                        updatedAt: updatedAt,
                        isPremium: false, // Backend doesn't have this field yet
                        isSuperset: false,
                        syncStatus: "synced",
                        needsSync: false,
                        lastSyncedAt: Date()
                    )
                    context.insert(newDeck)
                    print("✅ App: Created new deck: \(backendDeck.name)")
                }
            }

            // Save context
            try context.save()
            print("✅ App: Successfully synced \(backendDecks.count) decks to local storage")

        } catch {
            print("❌ App: Failed to sync decks from backend: \(error.localizedDescription)")
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if case .validating = authService.authState {
                    // Show loading screen while validating JWT token
                    VStack(spacing: 20) {
                        ProgressView()
                            .scaleEffect(1.5)
                        Text("Signing you in...")
                            .font(.headline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: UIColor.systemBackground))
                } else if authService.isAuthenticated && onboardingState.isOnboardingComplete {
                    // Main app content
                    ContentView()
                        .modelContainer(persistenceController.container)
                        .environmentObject(authService)
                        .environmentObject(deepLinkHandler)
                } else {
                    // Onboarding and authentication flow
                    OnboardingView()
                        .environmentObject(authService)
                        .environmentObject(onboardingState)
                }
            }
            .animation(.easeInOut(duration: 0.5), value: authService.isAuthenticated)
            .animation(.easeInOut(duration: 0.5), value: onboardingState.isOnboardingComplete)
            .onOpenURL { url in
                if authService.isAuthenticated && onboardingState.isOnboardingComplete {
                    deepLinkHandler.handle(url: url)
                }
            }
            .onAppear {
                // Update widget data when app launches
                if authService.isAuthenticated {
                    // Debug: Print full database state to diagnose widget issues
                    WidgetDataService.shared.debugDatabaseState()

                    WidgetDataService.shared.refreshOnAppLaunch()
                    // Debug: Print shared defaults to help troubleshoot
                    WidgetDataService.shared.debugSharedDefaults()

                    // Check for expired deck silences on app launch
                    SpacedRepetitionService.shared.checkAndUpdateExpiredSilences(
                        context: persistenceController.container.mainContext
                    )

                    // Sync decks from backend on app launch
                    Task {
                        await syncDecksFromBackend()
                    }
                }
            }
            .onChange(of: authService.isAuthenticated) { oldValue, newValue in
                if newValue && oldValue != newValue {
                    // Update widget data when user logs in
                    WidgetDataService.shared.refreshOnAppLaunch()

                    // Sync decks from backend after authentication
                    Task {
                        await syncDecksFromBackend()
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                if authService.isAuthenticated {
                    // A3 Fix: Check token expiration when app becomes active
                    Task {
                        if authService.isTokenExpired() {
                            print("🔐 App became active - token expired, attempting refresh...")
                            await authService.attemptTokenRefresh()
                        }
                    }

                    // Update widget data when app becomes active (returns from background)
                    WidgetDataService.shared.refreshOnAppLaunch()
                    print("🎯 App became active - refreshing widget data")
                }
            }
            // A2 Fix: Listen for session expiration notifications
            .onReceive(NotificationCenter.default.publisher(for: .sessionExpired)) { _ in
                print("🔐 App received session expired notification")
                // AuthService.signOut() is already called by APIConfiguration
                // This notification allows views to react if needed
            }
        }
    }
}
