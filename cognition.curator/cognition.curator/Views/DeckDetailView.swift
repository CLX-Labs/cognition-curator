import SwiftUI
import UIKit
import SwiftData

struct DeckDetailView: View {
    let deck: Deck
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @State private var showingAddCard = false
    @State private var showingEditDeck = false
    @State private var searchText = ""
    @State private var showingDeleteConfirmation = false
    @State private var isDeleting = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var showingSilenceSettings = false

    // Services
    @EnvironmentObject private var authService: AuthenticationService

    private var deckAPIService: DeckAPIService {
        DeckAPIService(authService: authService)
    }

    var filteredCards: [Flashcard] {
        let cards = deck.flashcards ?? []
        if searchText.isEmpty {
            return cards.sorted { $0.createdAt > $1.createdAt }
        } else {
            return cards.filter { card in
                card.question.localizedCaseInsensitiveContains(searchText) ||
                card.answer.localizedCaseInsensitiveContains(searchText)
            }.sorted { $0.createdAt > $1.createdAt }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with deck info
            deckHeader

            // Search bar
            searchBar

            // Cards list
            cardsList
        }
        .background(Color(uiColor: UIColor.systemGroupedBackground))
        .navigationTitle(deck.name.isEmpty ? "Deck" : deck.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: { showingAddCard = true }) {
                        Label("Add Card", systemImage: "plus")
                    }

                    Button(action: { showingEditDeck = true }) {
                        Label("Edit Deck", systemImage: "pencil")
                    }

                    Button(action: {
                        // Start review
                    }) {
                        Label("Start Review", systemImage: "brain.head.profile")
                    }

                    Button(action: { showingSilenceSettings = true }) {
                        Label(deck.isCurrentlySilenced ? "Manage Silence" : "Silence Deck",
                              systemImage: deck.isCurrentlySilenced ? "speaker.slash.fill" : "speaker.slash")
                    }

                    Divider()

                    Button(role: .destructive, action: {
                        showingDeleteConfirmation = true
                    }) {
                        Label("Delete Deck", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title2)
                        .foregroundColor(.blue)
                }
            }
        }
        .sheet(isPresented: $showingAddCard) {
            AddCardView(deck: deck)
        }
        .sheet(isPresented: $showingEditDeck) {
            EditDeckView(deck: deck)
        }
        .sheet(isPresented: $showingSilenceSettings) {
            DeckSilenceView(deck: deck)
        }
        .alert("Delete Deck", isPresented: $showingDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                Task {
                    await deleteDeck()
                }
            }
        } message: {
            Text("Are you sure you want to delete \"\(deck.name.isEmpty ? "this deck" : deck.name)\"? This action cannot be undone.")
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    private var deckHeader: some View {
        VStack(spacing: 16) {
            // Deck stats
            HStack(spacing: 24) {
                StatItem(
                    title: "Cards",
                    value: "\(filteredCards.count)",
                    icon: "rectangle.stack.fill",
                    color: .blue
                )

                StatItem(
                    title: "Reviewed",
                    value: "\(getReviewedCount())",
                    icon: "checkmark.circle.fill",
                    color: .green
                )

                StatItem(
                    title: "Due",
                    value: "\(getDueCount())",
                    icon: "clock.fill",
                    color: .orange
                )
            }

            // Progress bar
            ProgressView(value: getProgressValue())
                .progressViewStyle(.linear)
                .scaleEffect(x: 1, y: 2, anchor: .center)
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("Search cards...", text: $searchText)
                .textFieldStyle(PlainTextFieldStyle())

            if !searchText.isEmpty {
                Button(action: { searchText = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private var cardsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if filteredCards.isEmpty {
                    emptyStateView
                } else {
                    ForEach(filteredCards, id: \.id) { card in
                        CardRowView(card: card)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 100)
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "rectangle.stack")
                .font(.system(size: 48))
                .foregroundColor(.gray)

            Text("No cards yet")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("Add your first card to get started")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button(action: { showingAddCard = true }) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Add First Card")
                        .fontWeight(.semibold)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Color.blue)
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.vertical, 40)
    }

    private func getReviewedCount() -> Int {
        let cards = deck.flashcards ?? []
        return cards.filter { !($0.reviewSessions?.isEmpty ?? true) }.count
    }

    private func getDueCount() -> Int {
        let cards = deck.flashcards ?? []
        return cards.filter { card in
            let sessions = card.reviewSessions ?? []
            let lastSession = sessions.sorted { ($0.reviewedAt ?? Date()) < ($1.reviewedAt ?? Date()) }.last
            return (lastSession?.nextReview ?? Date()) <= Date()
        }.count
    }

    private func getProgressValue() -> Double {
        let totalCards = filteredCards.count
        guard totalCards > 0 else { return 0 }
        return Double(getReviewedCount()) / Double(totalCards)
    }

    // MARK: - Actions

    private func deleteDeck() async {
        guard let deckId = deck.id.uuidString as String? else {
            await MainActor.run {
                errorMessage = "Invalid deck ID"
                showingError = true
            }
            return
        }

        await MainActor.run {
            isDeleting = true
        }

        do {
            // Delete from backend
            try await deckAPIService.deleteDeck(id: deckId)

            // Delete from SwiftData (local)
            await MainActor.run {
                modelContext.delete(deck)
                do {
                    try modelContext.save()
                    dismiss() // Navigate back
                } catch {
                    errorMessage = "Failed to delete deck locally: \(error.localizedDescription)"
                    showingError = true
                }
                isDeleting = false
            }
        } catch {
            await MainActor.run {
                isDeleting = false
                errorMessage = "Failed to delete deck: \(error.localizedDescription)"
                showingError = true
            }
        }
    }
}

struct StatItem: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.primary)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct CardRowView: View {
    let card: Flashcard
    @State private var showingAnswer = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Question")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)

                    ExpandableText(
                        text: card.question.isEmpty ? "No question" : card.question,
                        lineLimit: 2,
                        font: .subheadline,
                        color: .primary
                    )
                }

                Spacer()

                Button(action: {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        showingAnswer.toggle()
                    }
                }) {
                    Image(systemName: showingAnswer ? "eye.slash" : "eye")
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }

            if showingAnswer {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Answer")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)

                    ExpandableText(
                        text: card.answer.isEmpty ? "No answer" : card.answer,
                        lineLimit: 3,
                        font: .subheadline,
                        color: .primary
                    )
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            // Card stats
            HStack {
                let stats = SpacedRepetitionService.shared.calculateReviewStats(for: card)

                Text("\(stats.totalReviews) reviews")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if stats.totalReviews > 0 {
                    Text("\(Int(stats.accuracy * 100))% accuracy")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(16)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 2)
    }
}

#Preview {
    NavigationStack {
        DeckDetailView(deck: PreviewHelper.createSampleDeck())
    }
    .modelContainer(PersistenceController.preview)
}
