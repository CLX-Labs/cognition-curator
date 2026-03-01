import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var onboardingState: OnboardingState
    @EnvironmentObject var authService: AuthenticationService

    var body: some View {
        ZStack {
            // Dynamic background gradient
            LinearGradient(
                colors: [
                    onboardingState.currentStep.page.primaryColor.opacity(0.3),
                    onboardingState.currentStep.page.secondaryColor.opacity(0.2)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.8), value: onboardingState.currentStep)

            if onboardingState.showingAuthentication {
                AppleOnlyAuthView(onSuccess: {
                    onboardingState.completeOnboarding()
                })
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            } else {
                OnboardingCarousel(onboardingState: onboardingState)
                    .transition(.asymmetric(
                        insertion: .move(edge: .leading).combined(with: .opacity),
                        removal: .move(edge: .trailing).combined(with: .opacity)
                    ))
            }
        }
        .animation(.easeInOut(duration: 0.6), value: onboardingState.showingAuthentication)
    }
}

// MARK: - Onboarding Carousel

struct OnboardingCarousel: View {
    @ObservedObject var onboardingState: OnboardingState
    @State private var animateContent = false

    var body: some View {
        VStack(spacing: 0) {
            // Skip button
            HStack {
                Spacer()

                Button("Skip") {
                    onboardingState.skipToAuthentication()
                }
                .font(.subheadline)
                .foregroundColor(.secondary)
                .padding(.horizontal, 24)
                .padding(.top, 16)
            }

            // Main content
            TabView(selection: $onboardingState.currentStep) {
                ForEach(OnboardingStep.allCases.filter { $0 != .authentication }, id: \.self) { step in
                    OnboardingPageView(
                        page: step.page,
                        isActive: step == onboardingState.currentStep
                    )
                    .tag(step)
                }
            }
            .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))
            .animation(.easeInOut(duration: 0.5), value: onboardingState.currentStep)

            // Bottom section
            VStack(spacing: 24) {
                // Page indicators
                HStack(spacing: 8) {
                    ForEach(OnboardingStep.allCases.filter { $0 != .authentication }, id: \.self) { step in
                        Circle()
                            .fill(step == onboardingState.currentStep ?
                                  onboardingState.currentStep.page.primaryColor :
                                  Color.gray.opacity(0.3))
                            .frame(width: 8, height: 8)
                            .scaleEffect(step == onboardingState.currentStep ? 1.2 : 1.0)
                            .animation(.spring(response: 0.3), value: onboardingState.currentStep)
                    }
                }

                // Navigation buttons
                HStack(spacing: 16) {
                    // Back button
                    if onboardingState.currentStep.rawValue > 0 {
                        Button(action: {
                            onboardingState.previousStep()
                        }) {
                            HStack {
                                Image(systemName: "chevron.left")
                                Text("Back")
                            }
                            .font(.headline)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.gray.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    // Next/Get Started button
                    Button(action: {
                        if onboardingState.currentStep == .progress {
                            onboardingState.skipToAuthentication()
                        } else {
                            onboardingState.nextStep()
                        }
                    }) {
                        HStack {
                            Text(onboardingState.currentStep == .progress ? "Get Started" : "Next")
                            if onboardingState.currentStep == .progress {
                                Image(systemName: "arrow.right")
                            } else {
                                Image(systemName: "chevron.right")
                            }
                        }
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(onboardingState.currentStep.page.primaryColor)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(.horizontal, 24)
            }
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Onboarding Page View

struct OnboardingPageView: View {
    let page: OnboardingPage
    let isActive: Bool

    @State private var animateIcon = false
    @State private var animateContent = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Animated icon
            ZStack {
                Circle()
                    .fill(page.primaryColor.opacity(0.1))
                    .frame(width: 140, height: 140)
                    .scaleEffect(animateIcon ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true), value: animateIcon)

                Circle()
                    .fill(page.secondaryColor.opacity(0.2))
                    .frame(width: 100, height: 100)
                    .scaleEffect(animateIcon ? 0.9 : 1.0)
                    .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: animateIcon)

                Image(systemName: page.imageName)
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [page.primaryColor, page.secondaryColor],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .rotationEffect(.degrees(animateIcon ? 5 : -5))
                    .animation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true), value: animateIcon)
            }
            .opacity(animateContent ? 1 : 0)
            .offset(y: animateContent ? 0 : 20)

            // Content
            VStack(spacing: 16) {
                Text(page.title)
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .opacity(animateContent ? 1 : 0)
                    .offset(y: animateContent ? 0 : 30)

                Text(page.subtitle)
                    .font(.title2)
                    .fontWeight(.medium)
                    .foregroundColor(page.primaryColor)
                    .multilineTextAlignment(.center)
                    .opacity(animateContent ? 1 : 0)
                    .offset(y: animateContent ? 0 : 40)

                Text(page.description)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(nil)
                    .padding(.horizontal, 32)
                    .opacity(animateContent ? 1 : 0)
                    .offset(y: animateContent ? 0 : 50)
            }

            Spacer()
        }
        .onAppear {
            if isActive {
                startAnimations()
            }
        }
        .onChange(of: isActive) { newValue in
            if newValue {
                startAnimations()
            } else {
                resetAnimations()
            }
        }
    }

    private func startAnimations() {
        withAnimation(.easeOut(duration: 0.8)) {
            animateContent = true
        }

        withAnimation(.easeInOut(duration: 0.5).delay(0.2)) {
            animateIcon = true
        }
    }

    private func resetAnimations() {
        animateContent = false
        animateIcon = false
    }
}

// MARK: - Authentication Flow

struct AuthenticationFlow: View {
    @ObservedObject var onboardingState: OnboardingState
    @StateObject private var authService = AuthenticationService.shared
    @State private var showingSignIn = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 16) {
                Text("Join Cognition Curator")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)

                Text("Start your learning journey today")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 60)
            .padding(.horizontal, 24)

            // Auth content
            if showingSignIn {
                SignInView(
                    onSuccess: {
                        onboardingState.completeOnboarding()
                    },
                    onSwitchToSignUp: {
                        showingSignIn = false
                    }
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            } else {
                SignUpView(
                    onSuccess: {
                        onboardingState.completeOnboarding()
                    },
                    onSwitchToSignIn: {
                        showingSignIn = true
                    }
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .leading).combined(with: .opacity),
                    removal: .move(edge: .trailing).combined(with: .opacity)
                ))
            }

            Spacer(minLength: 20)

            // Back to onboarding
            Button(action: {
                onboardingState.showingAuthentication = false
                onboardingState.currentStep = .progress
            }) {
                HStack {
                    Image(systemName: "chevron.left")
                    Text("Back to Overview")
                }
                .font(.subheadline)
                .foregroundColor(.secondary)
            }
            .padding(.bottom, 32)
        }
        .animation(.easeInOut(duration: 0.4), value: showingSignIn)
    }
}

#Preview {
    OnboardingView()
}
