import SwiftUI

struct AppleOnlyAuthView: View {
    @EnvironmentObject var authService: AuthenticationService
    let onSuccess: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // App branding section
            VStack(spacing: 24) {
                // App icon or logo
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 80))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                // App name and tagline
                VStack(spacing: 12) {
                    Text("Cognition Curator")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)

                    Text("Master knowledge through\nintelligent spaced repetition")
                        .font(.title3)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            // Features highlight
            VStack(spacing: 16) {
                FeatureRow(icon: "brain", title: "AI-Powered Learning", description: "Personalized study schedules")
                FeatureRow(icon: "chart.line.uptrend.xyaxis", title: "Track Progress", description: "Detailed analytics & insights")
                FeatureRow(icon: "icloud.and.arrow.up", title: "Sync Everywhere", description: "Access your decks anywhere")
            }
            .padding(.horizontal, 32)

            Spacer()

            // Authentication section
            VStack(spacing: 20) {
                // Apple Sign In button
                AppleSignInButton {
                    Task {
                        await authService.signInWithApple()
                        if authService.isAuthenticated {
                            onSuccess()
                        }
                    }
                }
                .frame(height: 50)
                .padding(.horizontal, 32)

                // Loading state
                if case .authenticating = authService.authState {
                    HStack(spacing: 12) {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text("Signing you in...")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 8)
                }

                // Error state
                if case .error(let error) = authService.authState {
                    VStack(spacing: 8) {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                            Text("Sign in failed")
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }

                        Text(error.localizedDescription)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 8)
                }

                // Privacy note
                Text("By signing in, you agree to our privacy policy.\nYour data is encrypted and secure.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 8)
            }

            Spacer(minLength: 40)
        }
        .background(
            LinearGradient(
                colors: [
                    Color.blue.opacity(0.05),
                    Color.purple.opacity(0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
    }
}

// MARK: - Supporting Views

struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.blue)
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)

                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
    }
}

#Preview {
    AppleOnlyAuthView(onSuccess: {})
}
