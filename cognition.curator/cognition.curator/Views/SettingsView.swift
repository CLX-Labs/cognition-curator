import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authService: AuthenticationService
    @State private var selectedReviewMode: ReviewMode
    @State private var maxNewCardsPerDay: Double
    @State private var maxReviewCardsPerDay: Double
    @State private var showingPremiumRequired = false

    init() {
        let service = SpacedRepetitionService.shared
        _selectedReviewMode = State(initialValue: service.currentReviewMode)
        _maxNewCardsPerDay = State(initialValue: Double(service.maxNewCardsPerDay))
        _maxReviewCardsPerDay = State(initialValue: Double(service.maxReviewCardsPerDay))
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    headerSection

                    // Widget Debug Section
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Widget Debug")
                            .font(.headline)
                            .fontWeight(.semibold)

                        HStack(spacing: 12) {
                            Button("Debug Data") {
                                WidgetDataService.shared.debugSharedDefaults()
                            }
                            .buttonStyle(.borderedProminent)
                            .font(.caption)

                            Button("Force Update") {
                                WidgetDataService.shared.updateWidgetData()
                                print("🎯 Manual widget update triggered")
                            }
                            .buttonStyle(.bordered)
                            .font(.caption)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Current Widget Data:")
                                .font(.caption)
                                .fontWeight(.semibold)

                            let sharedDefaults = UserDefaults(suiteName: "group.collect.software.cognition-curator") ?? UserDefaults.standard
                            let dueCount = sharedDefaults.integer(forKey: "widget.dueCardsCount")
                            let hasCards = sharedDefaults.bool(forKey: "widget.hasCards")
                            let hasTopCard = sharedDefaults.bool(forKey: "widget.topCard.hasContent")
                            let question = sharedDefaults.string(forKey: "widget.topCard.question") ?? "None"
                            let deckName = sharedDefaults.string(forKey: "widget.topCard.deckName") ?? "None"

                            Group {
                                Text("Due Count: \(dueCount)")
                                Text("Has Cards: \(hasCards ? "Yes" : "No")")
                                Text("Has Top Card: \(hasTopCard ? "Yes" : "No")")
                                Text("Question: \(question)")
                                Text("Deck: \(deckName)")
                            }
                            .font(.caption)
                            .foregroundColor(.secondary)
                        }
                        .padding()
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 20)

                    reviewModeSection
                    dailyLimitsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
            }
            .background(Color(uiColor: UIColor.systemGroupedBackground))
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        saveSettings()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .alert("Premium Feature", isPresented: $showingPremiumRequired) {
            Button("OK") { }
            Button("Upgrade") {
                // TODO: Handle premium upgrade
            }
        } message: {
            Text("This review mode requires a premium subscription to unlock advanced features.")
        }
    }

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "gear.circle.fill")
                .font(.system(size: 60))
                .foregroundColor(.blue)

            Text("Review Settings")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Customize your learning experience")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var reviewModeSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Review Mode")
                .font(.title3)
                .fontWeight(.semibold)

            VStack(spacing: 12) {
                ForEach(ReviewMode.allCases, id: \.self) { mode in
                    ReviewModeRow(
                        mode: mode,
                        isSelected: selectedReviewMode == mode,
                        onTap: {
                            if mode.isPremium {
                                showingPremiumRequired = true
                            } else {
                                selectedReviewMode = mode
                            }
                        }
                    )
                }
            }
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

    private var dailyLimitsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily Limits")
                .font(.title3)
                .fontWeight(.semibold)

            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("New Cards per Day")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Spacer()

                        Text("\(Int(maxNewCardsPerDay))")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                    }

                    Slider(value: $maxNewCardsPerDay, in: 1...10, step: 1)
                        .accentColor(.blue)
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Review Cards per Day")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Spacer()

                        Text("\(Int(maxReviewCardsPerDay))")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.green)
                    }

                    Slider(value: $maxReviewCardsPerDay, in: 1...15, step: 1)
                        .accentColor(.green)
                }
            }
        }
        .padding(20)
        .background(Color(uiColor: UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }







    private func saveSettings() {
        let service = SpacedRepetitionService.shared

        // Only save non-premium modes if not premium user
        if !selectedReviewMode.isPremium {
            service.currentReviewMode = selectedReviewMode
        }

        service.maxNewCardsPerDay = Int(maxNewCardsPerDay)
        service.maxReviewCardsPerDay = Int(maxReviewCardsPerDay)
    }
}

struct ReviewModeRow: View {
    let mode: ReviewMode
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(mode.displayName)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        if mode.isPremium {
                            Image(systemName: "crown.fill")
                                .font(.caption)
                                .foregroundColor(.yellow)
                        }
                    }

                    Text(mode.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundColor(.blue)
                } else {
                    Image(systemName: "circle")
                        .font(.title3)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}



#Preview {
    SettingsView()
}
