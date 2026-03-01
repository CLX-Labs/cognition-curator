import SwiftUI
import UIKit
import SwiftData

// Simple data structure for AI-generated flashcards
struct FlashcardData {
    let question: String
    let answer: String
}

struct CreateDeckView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authService: AuthenticationService

    @State private var deckName = ""
    @State private var isSuperset = false
    @State private var isPremium = false
    @State private var showingAIGeneration = false
    @State private var showingAIReview = false
    @State private var aiTopic = ""
    @State private var aiDifficulty: CardDifficulty = .medium
    @State private var aiNumberOfCards = 15
    @State private var generatedCards: [AIGeneratedCard] = []
    @State private var isGenerating = false
    @State private var isCreating = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var deckCreatedByAI = false
    @StateObject private var aiService = AIGenerationService.shared

    private var deckAPIService: DeckAPIService {
        DeckAPIService(authService: authService)
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerSection

                    // Basic info form
                    basicInfoSection

                    // Creation method selector
                    creationMethodSection

                    // AI generation section (if AI method selected)
                    if showingAIGeneration {
                        aiGenerationSection
                    }

                    // Superset options
                    supersetSection

                    Spacer(minLength: 100)
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
            }
            .background(Color(uiColor: UIColor.systemGroupedBackground))
            .navigationTitle("Create Deck")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    if isCreating {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Button(showingAIGeneration && deckCreatedByAI ? "Done" : "Create") {
                            Task {
                                await createDeck()
                            }
                        }
                        .fontWeight(.semibold)
                        .disabled(deckName.isEmpty)
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
        }
    }

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "rectangle.stack.badge.plus")
                .font(.system(size: 48))
                .foregroundColor(.blue)

            Text("Create a New Deck")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Start building your knowledge with flashcards")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var basicInfoSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Basic Information")
                .font(.headline)
                .fontWeight(.semibold)

            VStack(alignment: .leading, spacing: 8) {
                Text("Deck Name")
                    .font(.subheadline)
                    .fontWeight(.medium)

                TextField("Enter deck name...", text: $deckName)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .font(.body)
            }

            Toggle(isOn: $isPremium) {
                HStack {
                    Image(systemName: "crown.fill")
                        .foregroundColor(.yellow)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Premium Deck")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Text("Enable CloudKit sync and advanced features")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: .blue))
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

    private var creationMethodSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Creation Method")
                .font(.headline)
                .fontWeight(.semibold)

            VStack(spacing: 12) {
                // Manual Creation Button
                Button(action: {
                    showingAIGeneration = false
                }) {
                    CreationMethodCard(
                        title: "Manual Creation",
                        description: "Create cards one by one with full control",
                        icon: "pencil.circle.fill",
                        color: .blue,
                        isSelected: !showingAIGeneration
                    )
                }
                .buttonStyle(PlainButtonStyle())

                // AI Generation Button
                Button(action: {
                    showingAIGeneration = true
                }) {
                    CreationMethodCard(
                        title: "AI Generation",
                        description: "Let AI create cards from a topic",
                        icon: "brain.head.profile.fill",
                        color: .purple,
                        isSelected: showingAIGeneration,
                        badge: "Smart"
                    )
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

    private var aiGenerationSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "brain.head.profile.fill")
                    .foregroundColor(.purple)
                Text("AI Generation Settings")
                    .font(.headline)
                    .fontWeight(.semibold)
            }

            VStack(alignment: .leading, spacing: 16) {
                // Topic Input
                VStack(alignment: .leading, spacing: 8) {
                    Text("Topic")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextField("e.g., 'Spanish verbs', 'Cell biology', 'React hooks'", text: $aiTopic)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .font(.body)
                }

                HStack(spacing: 16) {
                    // Difficulty Selector
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Difficulty")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Picker("Difficulty", selection: $aiDifficulty) {
                            ForEach(CardDifficulty.allCases, id: \.self) { difficulty in
                                Text(difficulty.displayName).tag(difficulty)
                            }
                        }
                        .pickerStyle(SegmentedPickerStyle())
                    }

                    // Number of Cards
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Cards")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Picker("Number of Cards", selection: $aiNumberOfCards) {
                            Text("10").tag(10)
                            Text("15").tag(15)
                            Text("20").tag(20)
                            Text("25").tag(25)
                        }
                        .pickerStyle(SegmentedPickerStyle())
                    }
                }

                // Generate Button
                Button(action: {
                    generateAICards()
                }) {
                    HStack {
                        if aiService.isGenerating {
                            ProgressView()
                                .scaleEffect(0.8)
                                .foregroundColor(.white)
                        } else {
                            Image(systemName: "wand.and.stars")
                        }
                        Text(aiService.isGenerating ? "Generating..." : "Generate \(aiNumberOfCards) Cards")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(aiTopic.isEmpty || aiService.isGenerating ? Color.gray : Color.purple)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(aiTopic.isEmpty || aiService.isGenerating)

                // Progress Bar
                if aiService.isGenerating {
                    VStack(spacing: 8) {
                        ProgressView(value: aiService.generationProgress)
                            .progressViewStyle(.linear)
                        .tint(.purple)

                        Text("Creating intelligent flashcards for \(aiTopic)...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // Tips
                VStack(alignment: .leading, spacing: 4) {
                    Text("💡 Tips for better results:")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)

                    Text("• Be specific: 'Spanish past tense verbs' vs 'Spanish'")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("• Include context: 'Python data structures for beginners'")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("• Mention your level: 'Advanced calculus concepts'")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 8)
            }
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
        .sheet(isPresented: $showingAIReview) {
            // Use AI topic as deck name if user hasn't entered one
            let effectiveDeckName = deckName.isEmpty ? aiTopic : deckName
            AICardReviewView(
                topic: aiTopic,
                deckName: effectiveDeckName,
                generatedCards: $generatedCards
            ) {
                // Called when deck is successfully created by AICardReviewView
                deckCreatedByAI = true
                // Also update the local deckName so it shows correctly
                if deckName.isEmpty {
                    deckName = aiTopic
                }
            }
        }
    }

    private var supersetSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Superset Options")
                .font(.headline)
                .fontWeight(.semibold)

            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: $isSuperset) {
                    HStack {
                        Image(systemName: "rectangle.stack.fill")
                            .foregroundColor(.blue)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Create as Superset")
                                .font(.subheadline)
                                .fontWeight(.medium)

                            Text("Combine multiple decks into one")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .toggleStyle(SwitchToggleStyle(tint: .blue))

                if isSuperset {
                    Text("You can add other decks to this superset after creation")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.leading, 32)
                }
            }
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

        private func generateAICards() {
        guard !aiTopic.isEmpty else { return }

        Task {
            do {
                print("🔧 CreateDeckView: Starting AI generation for topic: \(aiTopic)")
                let cards = try await aiService.generateFlashcards(
                    topic: aiTopic,
                    numberOfCards: aiNumberOfCards,
                    difficulty: aiDifficulty
                )

                print("🔧 CreateDeckView: Received \(cards.count) cards from AI service")

                await MainActor.run {
                    print("🔧 CreateDeckView: Setting generatedCards to \(cards.count) cards")
                    generatedCards = cards
                    print("🔧 CreateDeckView: generatedCards.count is now \(generatedCards.count)")

                    // Only show review if we have cards
                    if !cards.isEmpty {
                        showingAIReview = true
                        print("🔧 CreateDeckView: Set showingAIReview to true")
                    } else {
                        errorMessage = "No cards were generated. Please try again."
                        showingError = true
                        print("⚠️ CreateDeckView: No cards generated")
                    }
                }
            } catch {
                print("❌ CreateDeckView: AI generation failed: \(error)")
                await MainActor.run {
                    errorMessage = "Failed to generate cards: \(error.localizedDescription)"
                    showingError = true
                }
            }
        }
    }

    private func createDeck() async {
        guard !deckName.isEmpty else { return }

        // If AI generation was used and deck was already created by AICardReviewView, just dismiss
        if showingAIGeneration && deckCreatedByAI {
            await MainActor.run {
                dismiss()
            }
            return
        }

        // If AI generation was used but no cards were generated, prevent creation
        if showingAIGeneration && generatedCards.isEmpty {
            await MainActor.run {
                errorMessage = "Please generate some cards first or switch to manual creation"
                showingError = true
            }
            return
        }

        await MainActor.run {
            isCreating = true
        }

        do {
            // Create deck via backend API
            let backendDeck = try await deckAPIService.createDeck(
                name: deckName,
                description: showingAIGeneration ? "AI-generated deck for \(aiTopic)" : nil,
                category: showingAIGeneration ? "AI Generated" : nil,
                color: "#007AFF"
            )

            // Also save locally in SwiftData for offline access
            await MainActor.run {
                let newDeck = Deck(
                    id: UUID(uuidString: backendDeck.id) ?? UUID(),
                    name: backendDeck.name,
                    createdAt: Date(),
                    isPremium: isPremium,
                    isSuperset: isSuperset
                )

                modelContext.insert(newDeck)

                do {
                    try modelContext.save()
                } catch {
                    print("Failed to save deck locally: \(error)")
                }

                isCreating = false
                dismiss()
            }
        } catch {
            await MainActor.run {
                isCreating = false
                errorMessage = "Failed to create deck: \(error.localizedDescription)"
                showingError = true
            }
        }
    }
}

// MARK: - Supporting Views

struct CreationMethodCard: View {
    let title: String
    let description: String
    let icon: String
    let color: Color
    let isSelected: Bool
    let badge: String?

    init(title: String, description: String, icon: String, color: Color, isSelected: Bool, badge: String? = nil) {
        self.title = title
        self.description = description
        self.icon = icon
        self.color = color
        self.isSelected = isSelected
        self.badge = badge
    }

    var body: some View {
        HStack(spacing: 16) {
            // Icon
            ZStack {
                Circle()
                    .fill(color.opacity(0.1))
                    .frame(width: 50, height: 50)

                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(color)
            }

            // Content
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)

                    if let badge = badge {
                        Text(badge)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(color.opacity(0.2))
                            .foregroundColor(color)
                            .clipShape(Capsule())
                    }
                }

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.leading)
            }

            Spacer()

            // Selection Indicator
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundColor(isSelected ? color : Color(uiColor: UIColor.systemGray3))
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isSelected ? color.opacity(0.05) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? color : Color(uiColor: UIColor.systemGray4), lineWidth: isSelected ? 2 : 1)
        )
    }
}

#Preview {
    CreateDeckView()
        .modelContainer(PersistenceController.preview)
}
