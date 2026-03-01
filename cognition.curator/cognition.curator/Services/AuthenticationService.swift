import Foundation
import SwiftUI
import CryptoKit
import AuthenticationServices
import ObjectiveC

// MARK: - Backend Response Models

struct BackendAuthResponse: Codable {
    let accessToken: String
    let user: BackendUser
    let isNewUser: Bool

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case user
        case isNewUser = "is_new_user"
    }
}

struct BackendUser: Codable {
    let id: String
    let email: String
    let name: String
    let displayName: String?
    let isPremium: Bool
    let isAppleUser: Bool
    let createdAt: String
    let lastLoginAt: String?
    let totalStudyTimeMinutes: Int
    let currentStreakDays: Int
    let longestStreakDays: Int
    let totalCardsReviewed: Int
    let totalDecksCreated: Int
    let overallAccuracyRate: Double
    let studyLevel: Int
    let levelProgress: Double

    enum CodingKeys: String, CodingKey {
        case id, email, name
        case displayName = "display_name"
        case isPremium = "is_premium"
        case isAppleUser = "is_apple_user"
        case createdAt = "created_at"
        case lastLoginAt = "last_login_at"
        case totalStudyTimeMinutes = "total_study_time_minutes"
        case currentStreakDays = "current_streak_days"
        case longestStreakDays = "longest_streak_days"
        case totalCardsReviewed = "total_cards_reviewed"
        case totalDecksCreated = "total_decks_created"
        case overallAccuracyRate = "overall_accuracy_rate"
        case studyLevel = "study_level"
        case levelProgress = "level_progress"
    }
}

struct AppleSignInRequest: Codable {
    let identityToken: String
    let authorizationCode: String?
    let user: AppleUserInfo?

    enum CodingKeys: String, CodingKey {
        case identityToken = "identity_token"
        case authorizationCode = "authorization_code"
        case user
    }
}

struct AppleUserInfo: Codable {
    let name: AppleUserName?
    let email: String?
}

struct AppleUserName: Codable {
    let firstName: String?
    let lastName: String?

    enum CodingKeys: String, CodingKey {
        case firstName = "firstName"
        case lastName = "lastName"
    }
}

struct BackendErrorResponse: Codable {
    let error: String
}

struct BackendProfileResponse: Codable {
    let user: BackendUser
}

// MARK: - Apple Sign In Delegate

private class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {

    private let completion: (Result<ASAuthorizationResult, Error>) -> Void

    init(completion: @escaping (Result<ASAuthorizationResult, Error>) -> Void) {
        self.completion = completion
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let result = ASAuthorizationResult(credential: authorization.credential, provider: authorization.provider)
        completion(.success(result))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        completion(.failure(error))
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            return UIWindow()
        }
        return window
    }
}

// MARK: - ASAuthorizationResult

private struct ASAuthorizationResult {
    let credential: ASAuthorizationCredential
    let provider: ASAuthorizationProvider
}

// MARK: - JWT Claims Structure (A1 Fix)

private struct JWTClaims: Decodable {
    let exp: TimeInterval       // Expiration timestamp
    let iat: TimeInterval?      // Issued at timestamp
    let sub: String?            // Subject (user ID)
}

// MARK: - Authentication Service

class AuthenticationService: ObservableObject {
    static let shared = AuthenticationService()

    @Published var authState: AuthenticationState = .unauthenticated
    @Published var currentUser: UserAccount?

    private let userDefaultsKey = "currentUserId"
    private let jwtTokenKey = "jwtToken"
    private let tokenExpirationKey = "jwtTokenExpiration"  // A1 Fix: Store expiration
    private let cachedUserKey = "cachedUserAccount"        // A4 Fix: Cache user data
    private let usersStorageKey = "storedUsers"

    // Backend configuration
    private let baseURL = APIConfiguration.baseURL

    init() {
        print("🔑 AuthService: Initializing authentication service...")
        APIConfiguration.printConfiguration()
        loadSavedUser()
    }

    // MARK: - JWT Token Management

    /// A1 Fix: Decode JWT to extract claims (expiration, etc.)
    private func decodeJWT(_ token: String) -> JWTClaims? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else {
            print("⚠️ AuthService: Invalid JWT format - expected 3 parts, got \(parts.count)")
            return nil
        }

        var payload = String(parts[1])
        // Add padding for base64 decoding
        while payload.count % 4 != 0 { payload += "=" }

        // Replace URL-safe characters
        payload = payload.replacingOccurrences(of: "-", with: "+")
        payload = payload.replacingOccurrences(of: "_", with: "/")

        guard let data = Data(base64Encoded: payload) else {
            print("⚠️ AuthService: Failed to decode JWT payload base64")
            return nil
        }

        do {
            let claims = try JSONDecoder().decode(JWTClaims.self, from: data)
            return claims
        } catch {
            print("⚠️ AuthService: Failed to decode JWT claims: \(error)")
            return nil
        }
    }

    /// A1 Fix: Save JWT token and extract/store expiration
    private func saveJWTToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: jwtTokenKey)
        print("🔑 AuthService: JWT token saved to UserDefaults")
        print("🔑 AuthService: Token preview: \(String(token.prefix(20)))...")

        // Extract and store expiration
        if let claims = decodeJWT(token) {
            UserDefaults.standard.set(claims.exp, forKey: tokenExpirationKey)
            let expirationDate = Date(timeIntervalSince1970: claims.exp)
            print("🔑 AuthService: Token expires at: \(expirationDate)")
        } else {
            // If we can't decode, set a default expiration (24 hours)
            let defaultExpiration = Date().addingTimeInterval(24 * 60 * 60).timeIntervalSince1970
            UserDefaults.standard.set(defaultExpiration, forKey: tokenExpirationKey)
            print("⚠️ AuthService: Could not decode JWT, using default 24h expiration")
        }
    }

    private func getJWTToken() -> String? {
        return UserDefaults.standard.string(forKey: jwtTokenKey)
    }

    private func clearJWTToken() {
        UserDefaults.standard.removeObject(forKey: jwtTokenKey)
        UserDefaults.standard.removeObject(forKey: tokenExpirationKey)
    }

    /// A1 Fix: Check if token is expired (with 5-minute buffer)
    func isTokenExpired() -> Bool {
        let expiration = UserDefaults.standard.double(forKey: tokenExpirationKey)
        guard expiration > 0 else {
            print("⚠️ AuthService: No expiration stored, considering token expired")
            return true
        }

        // Consider expired 5 minutes before actual expiration (buffer for network latency)
        let bufferSeconds: TimeInterval = 300 // 5 minutes
        let isExpired = Date().timeIntervalSince1970 > (expiration - bufferSeconds)

        if isExpired {
            let expirationDate = Date(timeIntervalSince1970: expiration)
            print("⚠️ AuthService: Token is expired or expiring soon (expires: \(expirationDate))")
        }

        return isExpired
    }

    /// A1 Fix: Get token expiration date for debugging
    func getTokenExpirationDate() -> Date? {
        let expiration = UserDefaults.standard.double(forKey: tokenExpirationKey)
        guard expiration > 0 else { return nil }
        return Date(timeIntervalSince1970: expiration)
    }

    /// A1 Fix: Public method for other services to get JWT token (with expiration check)
    func getCurrentJWTToken() -> String? {
        guard let token = getJWTToken() else {
            print("🔑 AuthService: getCurrentJWTToken called, no token exists")
            return nil
        }

        // Check if token is expired
        if isTokenExpired() {
            print("⚠️ AuthService: Token expired, attempting refresh...")
            // Trigger async refresh but return nil for now
            Task { await attemptTokenRefresh() }
            return nil
        }

        print("🔑 AuthService: getCurrentJWTToken called, token valid")
        return token
    }

    /// A1 Fix: Attempt to refresh the token
    func attemptTokenRefresh() async {
        print("🔑 AuthService: Attempting token refresh...")

        guard let currentToken = getJWTToken() else {
            print("❌ AuthService: No token to refresh, signing out")
            await MainActor.run { signOut() }
            return
        }

        guard let url = URL(string: "\(baseURL)\(APIConfiguration.Auth.refresh)") else {
            print("❌ AuthService: Invalid refresh URL")
            await MainActor.run { signOut() }
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(currentToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await APIConfiguration.authURLSession.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                print("❌ AuthService: Invalid response during refresh")
                await MainActor.run { signOut() }
                return
            }

            if httpResponse.statusCode == 200 {
                // Try to decode new token from response
                if let refreshResponse = try? JSONDecoder().decode(BackendAuthResponse.self, from: data) {
                    saveJWTToken(refreshResponse.accessToken)
                    print("✅ AuthService: Token refreshed successfully")
                    return
                }
            }

            print("❌ AuthService: Token refresh failed with status \(httpResponse.statusCode)")
            await MainActor.run { signOut() }

        } catch {
            print("❌ AuthService: Token refresh network error: \(error.localizedDescription)")
            // Don't sign out on network error - keep existing token
        }
    }

        // Get user profile from backend using JWT token
    private func getUserFromBackend(_ token: String) async -> UserAccount? {
        print("🔑 AuthService: Fetching user profile from backend...")

        guard let url = URL(string: "\(baseURL)/auth/profile") else {
            print("❌ AuthService: Invalid profile URL")
            return nil
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await APIConfiguration.authURLSession.data(for: urlRequest)

            if let httpResponse = response as? HTTPURLResponse {
                print("🔑 AuthService: Profile request status: \(httpResponse.statusCode)")

                if httpResponse.statusCode == 200 {
                    let profileResponse = try JSONDecoder().decode(BackendProfileResponse.self, from: data)
                    let userAccount = convertBackendUserToUserAccount(profileResponse.user)
                    print("✅ AuthService: Successfully parsed user profile from backend")
                    return userAccount
                } else {
                    print("❌ AuthService: Profile request failed with status: \(httpResponse.statusCode)")
                    return nil
                }
            }
            print("❌ AuthService: Invalid HTTP response for profile")
            return nil
        } catch {
            print("❌ AuthService: Profile request error: \(error.localizedDescription)")
            return nil
        }
    }

    // Validate JWT token with backend
    private func validateJWTToken(_ token: String) async -> Bool {
        print("🔑 AuthService: Starting JWT validation...")

        guard let url = URL(string: "\(baseURL)/auth/profile") else {
            print("❌ AuthService: Invalid profile URL")
            return false
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        print("🔑 AuthService: Making request to: \(url)")

        do {
            let (data, response) = try await APIConfiguration.authURLSession.data(for: urlRequest)

            if let httpResponse = response as? HTTPURLResponse {
                print("🔑 AuthService: Received response with status: \(httpResponse.statusCode)")

                if httpResponse.statusCode == 200 {
                    print("✅ AuthService: JWT token is valid")
                    return true
                } else {
                    print("❌ AuthService: JWT token invalid, status: \(httpResponse.statusCode)")
                    if let responseString = String(data: data, encoding: .utf8) {
                        print("❌ AuthService: Response body: \(responseString)")
                    }
                    return false
                }
            }
            print("❌ AuthService: Invalid HTTP response")
            return false
        } catch {
            print("❌ AuthService: JWT validation network error: \(error.localizedDescription)")

            // Only allow token validation to pass in DEBUG mode if server is unreachable
            // In production, we must validate the token
            #if DEBUG
            print("⚠️ AuthService: Server unreachable in development, assuming token valid")
            return true
            #else
            print("❌ AuthService: Server unreachable in production, token validation failed")
            return false
            #endif
        }
    }

    // MARK: - Backend API Calls

    private func sendAppleSignInToBackend(identityToken: String, authorizationCode: String?, userInfo: AppleUserInfo?) async throws -> BackendAuthResponse {
        guard let url = URL(string: "\(baseURL)/auth/apple-signin") else {
            throw AuthError.unknown("Invalid backend URL")
        }

        let request = AppleSignInRequest(
            identityToken: identityToken,
            authorizationCode: authorizationCode,
            user: userInfo
        )

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            urlRequest.httpBody = try JSONEncoder().encode(request)
        } catch {
            throw AuthError.unknown("Failed to encode request")
        }

        // Use auth-specific URLSession with extended timeout for Apple Sign In
        // This accounts for cold starts and Apple token verification delays
        do {
            let (data, response) = try await APIConfiguration.authURLSession.data(for: urlRequest)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw AuthError.unknown("Invalid response")
            }

            if httpResponse.statusCode == 200 || httpResponse.statusCode == 201 {
                let authResponse = try JSONDecoder().decode(BackendAuthResponse.self, from: data)
                return authResponse
            } else {
                // Try to decode error response
                if let errorResponse = try? JSONDecoder().decode(BackendErrorResponse.self, from: data) {
                    throw AuthError.unknown(errorResponse.error)
                } else {
                    throw AuthError.unknown("Authentication failed with status \(httpResponse.statusCode)")
                }
            }
        } catch {
            if error is AuthError {
                throw error
            }
            throw AuthError.unknown("Network error: \(error.localizedDescription)")
        }
    }

    private func convertBackendUserToUserAccount(_ backendUser: BackendUser) -> UserAccount {
        return UserAccount(
            id: UUID(uuidString: backendUser.id) ?? UUID(),
            email: backendUser.email,
            name: backendUser.name,
            createdAt: ISO8601DateFormatter().date(from: backendUser.createdAt) ?? Date(),
            isPremium: backendUser.isPremium,
            streakCount: backendUser.currentStreakDays,
            totalReviews: backendUser.totalCardsReviewed,
            appleId: backendUser.isAppleUser ? "backend_apple_user" : nil
        )
    }

    // MARK: - Public Methods

    func signUp(name: String, email: String, password: String) async {
        await MainActor.run {
            authState = .authenticating
        }

        // Simulate network delay
        try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds

        // Validate input
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            await setError(.unknown("Name cannot be empty"))
            return
        }

        guard isValidEmail(email) else {
            await setError(.invalidEmail)
            return
        }

        guard password.count >= 8 else {
            await setError(.weakPassword)
            return
        }

        // Check if user already exists
        if await userExists(email: email) {
            await setError(.emailAlreadyExists)
            return
        }

        // Create new user
        let newUser = UserAccount(
            id: UUID(),
            email: email.lowercased(),
            name: name,
            createdAt: Date(),
            isPremium: false,
            streakCount: 0,
            totalReviews: 0,
            appleId: nil
        )

        // Store user credentials (in production, this would be handled by a secure backend)
        await storeUser(user: newUser, password: password)

        await MainActor.run {
            currentUser = newUser
            authState = .authenticated(newUser)
            saveCurrentUser(newUser)
        }
    }

    func signIn(email: String, password: String) async {
        await MainActor.run {
            authState = .authenticating
        }

        // Simulate network delay
        try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second

        guard let storedUser = await getStoredUser(email: email.lowercased()) else {
            await setError(.userNotFound)
            return
        }

        guard await verifyPassword(password, for: email.lowercased()) else {
            await setError(.wrongPassword)
            return
        }

        await MainActor.run {
            currentUser = storedUser
            authState = .authenticated(storedUser)
            saveCurrentUser(storedUser)
        }
    }

    func signOut() {
        withAnimation(.easeInOut(duration: 0.5)) {
            authState = .unauthenticated
            currentUser = nil
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)
            clearJWTToken()
            clearCachedUser()  // A4 Fix: Also clear cached user
        }
    }

    // MARK: - Apple Sign In (Updated to use Backend)

    func signInWithApple() async {
        await MainActor.run {
            authState = .authenticating
        }

        // Check if we're running on simulator
        #if targetEnvironment(simulator)
        // Apple Sign In doesn't work reliably on simulator, provide a demo account
        await createSimulatorAppleUser()
        #else
        // Real device Apple Sign In implementation
        do {
            let result = try await performAppleSignIn()

            guard let appleIDCredential = result.credential as? ASAuthorizationAppleIDCredential else {
                await setError(.unknown("Invalid Apple ID credential"))
                return
            }

            let userIdentifier = appleIDCredential.user
            let fullName = appleIDCredential.fullName
            let email = appleIDCredential.email

            // Extract identity token
            guard let identityTokenData = appleIDCredential.identityToken,
                  let identityToken = String(data: identityTokenData, encoding: .utf8) else {
                await setError(.unknown("Failed to get identity token"))
                return
            }

            // Extract authorization code
            var authorizationCode: String?
            if let authCodeData = appleIDCredential.authorizationCode {
                authorizationCode = String(data: authCodeData, encoding: .utf8)
            }

            // Prepare user info for backend
            var userInfo: AppleUserInfo?
            if let fullName = fullName, let email = email {
                userInfo = AppleUserInfo(
                    name: AppleUserName(
                        firstName: fullName.givenName,
                        lastName: fullName.familyName
                    ),
                    email: email
                )
            }

            // Send to backend
            do {
                let response = try await sendAppleSignInToBackend(
                    identityToken: identityToken,
                    authorizationCode: authorizationCode,
                    userInfo: userInfo
                )

                // Save JWT token
                saveJWTToken(response.accessToken)

                // Convert backend user to local user model
                let userAccount = convertBackendUserToUserAccount(response.user)

                // A4 Fix: Cache user for offline restoration
                cacheUserAccount(userAccount)

                await MainActor.run {
                    currentUser = userAccount
                    authState = .authenticated(userAccount)
                    saveCurrentUser(userAccount)
                }

                print("✅ Apple Sign In successful! New user: \(response.isNewUser)")

            } catch {
                await setError(.unknown("Backend authentication failed: \(error.localizedDescription)"))
                return
            }

        } catch {
            let errorMessage: String
            if let authError = error as? ASAuthorizationError {
                switch authError.code {
                case .canceled:
                    errorMessage = "Apple Sign In was canceled"
                case .failed:
                    errorMessage = "Apple Sign In failed. Please try again."
                case .invalidResponse:
                    errorMessage = "Invalid response from Apple Sign In"
                case .notHandled:
                    errorMessage = "Apple Sign In is not available"
                case .unknown:
                    errorMessage = "Apple Sign In encountered an unknown error"
                case .notInteractive:
                    errorMessage = "Apple Sign In requires user interaction"
                case .matchedExcludedCredential:
                    errorMessage = "Apple Sign In credential is excluded"
                case .credentialImport:
                    errorMessage = "Apple Sign In credential import failed"
                case .credentialExport:
                    errorMessage = "Apple Sign In credential export failed"
                @unknown default:
                    errorMessage = "Apple Sign In failed with error: \(error.localizedDescription)"
                }
            } else {
                errorMessage = "Apple Sign In failed: \(error.localizedDescription)"
            }
            await setError(.unknown(errorMessage))
        }
        #endif
    }

    private func createSimulatorAppleUser() async {
        // For simulator testing, also hit the backend with demo data
        do {
            // Use a consistent mock identity token for testing (reuse existing user)
            let mockToken = "simulator-test-token-1705739520"

            let userInfo = AppleUserInfo(
                name: AppleUserName(
                    firstName: "Demo",
                    lastName: "User"
                ),
                email: "demo.user@privaterelay.appleid.com"
            )

            // Try to hit the backend first
            let response = try await sendAppleSignInToBackend(
                identityToken: mockToken,
                authorizationCode: "simulator-auth-code",
                userInfo: userInfo
            )

            // Save JWT token
            saveJWTToken(response.accessToken)

            // Convert backend user to local user model
            let userAccount = convertBackendUserToUserAccount(response.user)

            await MainActor.run {
                currentUser = userAccount
                authState = .authenticated(userAccount)
                saveCurrentUser(userAccount)
            }

            print("✅ Simulator Apple Sign In successful! Backend user created: \(response.isNewUser)")

        } catch {
            print("⚠️ Backend unavailable in simulator, using local demo user: \(error)")

            // Fallback to local demo user if backend is unavailable
            let demoUser = UserAccount(
                id: UUID(),
                email: "apple.demo@privaterelay.appleid.com",
                name: "Apple Demo User",
                createdAt: Date(),
                isPremium: false,
                streakCount: 3,
                totalReviews: 25,
                appleId: "simulator_apple_user"
            )

            await storeAppleUser(user: demoUser)

            await MainActor.run {
                currentUser = demoUser
                authState = .authenticated(demoUser)
                saveCurrentUser(demoUser)
            }
        }
    }

    @MainActor
    private func performAppleSignIn() async throws -> ASAuthorizationResult {
        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])

        return try await withCheckedThrowingContinuation { continuation in
            let delegate = AppleSignInDelegate { result in
                switch result {
                case .success(let authResult):
                    continuation.resume(returning: authResult)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }

            controller.delegate = delegate
            controller.presentationContextProvider = delegate

            // Store delegate in the controller to keep it alive
            objc_setAssociatedObject(controller, "delegate", delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

            controller.performRequests()
        }
    }

    func deleteAccount() async {
        guard let user = currentUser else { return }

        await MainActor.run {
            authState = .authenticating
        }

        // Simulate network delay
        try? await Task.sleep(nanoseconds: 1_000_000_000)

        // Remove user data
        await removeStoredUser(userId: user.id)

        await MainActor.run {
            authState = .unauthenticated
            currentUser = nil
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)
            clearJWTToken()
        }
    }

    var isAuthenticated: Bool {
        if case .authenticated = authState {
            return true
        }
        return false
    }

    // MARK: - Public API Helper

    /// Creates an authenticated URLRequest with JWT token for other services to use
    func createAuthenticatedRequest(url: URL, method: String = "GET") -> URLRequest? {
        guard let token = getJWTToken() else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        return request
    }



    // MARK: - Private Methods

    private func setError(_ error: AuthError) async {
        await MainActor.run {
            authState = .error(error)
        }

        // Auto-clear error after 3 seconds
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        await MainActor.run {
            if case .error = authState {
                authState = .unauthenticated
            }
        }
    }

    private func isValidEmail(_ email: String) -> Bool {
        let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,64}"
        let emailPredicate = NSPredicate(format:"SELF MATCHES %@", emailRegex)
        return emailPredicate.evaluate(with: email)
    }

    private func hashPassword(_ password: String) -> String {
        let data = Data(password.utf8)
        let hashed = SHA256.hash(data: data)
        return hashed.compactMap { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Storage Methods (Mock implementation)

    private func storeUser(user: UserAccount, password: String) async {
        var storedUsers = getStoredUsers()
        let hashedPassword = hashPassword(password)

        let userDict: [String: Any] = [
            "id": user.id.uuidString,
            "email": user.email,
            "name": user.name,
            "createdAt": user.createdAt.timeIntervalSince1970,
            "isPremium": user.isPremium,
            "streakCount": user.streakCount,
            "totalReviews": user.totalReviews,
            "passwordHash": hashedPassword
        ]

        storedUsers[user.email] = userDict
        UserDefaults.standard.set(storedUsers, forKey: usersStorageKey)
    }

    private func getStoredUser(email: String) async -> UserAccount? {
        let storedUsers = getStoredUsers()

        guard let userDict = storedUsers[email] as? [String: Any],
              let idString = userDict["id"] as? String,
              let id = UUID(uuidString: idString),
              let userEmail = userDict["email"] as? String,
              let name = userDict["name"] as? String,
              let createdAtInterval = userDict["createdAt"] as? TimeInterval,
              let isPremium = userDict["isPremium"] as? Bool,
              let streakCount = userDict["streakCount"] as? Int,
              let totalReviews = userDict["totalReviews"] as? Int else {
            return nil
        }

        return UserAccount(
            id: id,
            email: userEmail,
            name: name,
            createdAt: Date(timeIntervalSince1970: createdAtInterval),
            isPremium: isPremium,
            streakCount: streakCount,
            totalReviews: totalReviews,
            appleId: userDict["appleId"] as? String
        )
    }

    private func userExists(email: String) async -> Bool {
        let storedUsers = getStoredUsers()
        return storedUsers[email] != nil
    }

    private func verifyPassword(_ password: String, for email: String) async -> Bool {
        let storedUsers = getStoredUsers()

        guard let userDict = storedUsers[email] as? [String: Any],
              let storedHash = userDict["passwordHash"] as? String else {
            return false
        }

        let inputHash = hashPassword(password)
        return inputHash == storedHash
    }

    private func removeStoredUser(userId: UUID) async {
        var storedUsers = getStoredUsers()

        // Find and remove user by ID
        for (email, userDict) in storedUsers {
            if let dict = userDict as? [String: Any],
               let idString = dict["id"] as? String,
               idString == userId.uuidString {
                storedUsers.removeValue(forKey: email)
                break
            }
        }

        UserDefaults.standard.set(storedUsers, forKey: usersStorageKey)
    }

    private func getStoredUsers() -> [String: Any] {
        return UserDefaults.standard.dictionary(forKey: usersStorageKey) ?? [:]
    }

    private func saveCurrentUser(_ user: UserAccount) {
        UserDefaults.standard.set(user.id.uuidString, forKey: userDefaultsKey)
    }

    private func loadSavedUser() {
        print("🔑 AuthService: Starting loadSavedUser()")

        let userIdString = UserDefaults.standard.string(forKey: userDefaultsKey)
        print("🔑 AuthService: userIdString from UserDefaults: \(userIdString ?? "nil")")

        guard let userIdString = userIdString,
              let userId = UUID(uuidString: userIdString) else {
            print("🔑 AuthService: No saved user ID found, setting state to unauthenticated")
            authState = .unauthenticated
            return
        }

        print("🔑 AuthService: Found saved user ID: \(userId)")

        // Check if we have a JWT token
        let jwtToken = getJWTToken()
        print("🔑 AuthService: JWT token exists: \(jwtToken != nil)")

        guard let jwtToken = jwtToken else {
            print("🔑 AuthService: No JWT token found on app launch, signing out")
            authState = .unauthenticated
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)
            return
        }

        // A1 Fix: Check if token is already expired before even trying
        if isTokenExpired() {
            print("⚠️ AuthService: Token expired on app launch, will attempt refresh")
        }

        print("🔑 AuthService: JWT token found on app launch, validating with backend...")
        print("🔑 AuthService: Setting state to .validating")
        authState = .validating

        Task {
            await performUserRestoration(userId: userId, jwtToken: jwtToken)
        }
    }

    /// A4 Fix: Separated restoration logic with better error handling
    private func performUserRestoration(userId: UUID, jwtToken: String) async {
        print("🔑 AuthService: Attempting to restore user from backend...")

        // Try to get user profile from backend using JWT token
        do {
            if let userFromBackend = await getUserFromBackend(jwtToken) {
                print("✅ AuthService: User profile retrieved from backend")

                // Store the user locally for future use and cache
                await storeAppleUser(user: userFromBackend)
                cacheUserAccount(userFromBackend)

                await MainActor.run {
                    currentUser = userFromBackend
                    authState = .authenticated(userFromBackend)
                    saveCurrentUser(userFromBackend)
                    print("✅ AuthService: User session restored from backend successfully")
                }
                return
            }
        }

        // If backend doesn't work, try cached user (A4 Fix)
        if let cachedUser = loadCachedUser() {
            print("⚠️ AuthService: Backend unavailable, using cached user data")
            await MainActor.run {
                currentUser = cachedUser
                authState = .authenticated(cachedUser)
                print("✅ AuthService: User session restored from cache (offline mode)")
            }
            return
        }

        // Try local storage as fallback
        let storedUsers = getStoredUsers()
        for (_, userDict) in storedUsers {
            if let dict = userDict as? [String: Any],
               let idString = dict["id"] as? String,
               idString == userId.uuidString,
               let email = dict["email"] as? String {

                if let user = await getStoredUser(email: email) {
                    print("🔑 AuthService: Found stored user locally, validating JWT token...")

                    // Validate the JWT token with the backend
                    let isValid = await validateJWTToken(jwtToken)
                    print("🔑 AuthService: JWT validation result: \(isValid)")

                    await MainActor.run {
                        if isValid {
                            currentUser = user
                            authState = .authenticated(user)
                            cacheUserAccount(user)  // Cache for offline use
                            print("✅ AuthService: User session restored successfully")
                        } else {
                            // A4 Fix: Check if validation failed due to network or actual auth issue
                            // If we have cached data and it's likely a network issue, use cached
                            if let cachedUser = loadCachedUser() {
                                print("⚠️ AuthService: Validation failed but using cached user (possible network issue)")
                                currentUser = cachedUser
                                authState = .authenticated(cachedUser)
                            } else {
                                print("❌ AuthService: JWT token is invalid, signing out")
                                authState = .unauthenticated
                                clearJWTToken()
                                UserDefaults.standard.removeObject(forKey: userDefaultsKey)
                            }
                        }
                    }
                    return
                }
            }
        }

        // Neither backend nor local storage worked
        print("❌ AuthService: Unable to restore user data, signing out")
        await MainActor.run {
            authState = .unauthenticated
            clearJWTToken()
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)
        }
    }

    // MARK: - A4 Fix: User Caching for Offline Support

    /// Cache user account for offline restoration
    private func cacheUserAccount(_ user: UserAccount) {
        let userDict: [String: Any] = [
            "id": user.id.uuidString,
            "email": user.email,
            "name": user.name,
            "createdAt": user.createdAt.timeIntervalSince1970,
            "isPremium": user.isPremium,
            "streakCount": user.streakCount,
            "totalReviews": user.totalReviews,
            "appleId": user.appleId ?? ""
        ]
        UserDefaults.standard.set(userDict, forKey: cachedUserKey)
        print("🔑 AuthService: User account cached for offline use")
    }

    /// Load cached user account
    private func loadCachedUser() -> UserAccount? {
        guard let userDict = UserDefaults.standard.dictionary(forKey: cachedUserKey),
              let idString = userDict["id"] as? String,
              let id = UUID(uuidString: idString),
              let email = userDict["email"] as? String,
              let name = userDict["name"] as? String,
              let createdAtInterval = userDict["createdAt"] as? TimeInterval,
              let isPremium = userDict["isPremium"] as? Bool,
              let streakCount = userDict["streakCount"] as? Int,
              let totalReviews = userDict["totalReviews"] as? Int else {
            return nil
        }

        let appleId = userDict["appleId"] as? String
        return UserAccount(
            id: id,
            email: email,
            name: name,
            createdAt: Date(timeIntervalSince1970: createdAtInterval),
            isPremium: isPremium,
            streakCount: streakCount,
            totalReviews: totalReviews,
            appleId: appleId?.isEmpty == true ? nil : appleId
        )
    }

    /// Clear cached user data (called on sign out)
    private func clearCachedUser() {
        UserDefaults.standard.removeObject(forKey: cachedUserKey)
    }

    // MARK: - Apple ID Storage Methods

    private func storeAppleUser(user: UserAccount) async {
        var storedUsers = getStoredUsers()

        let userDict: [String: Any] = [
            "id": user.id.uuidString,
            "email": user.email,
            "name": user.name,
            "createdAt": user.createdAt.timeIntervalSince1970,
            "isPremium": user.isPremium,
            "streakCount": user.streakCount,
            "totalReviews": user.totalReviews,
            "appleId": user.appleId ?? ""
        ]

        // Store by Apple ID instead of email for Apple users
        if let appleId = user.appleId {
            storedUsers["apple_\(appleId)"] = userDict
        }

        UserDefaults.standard.set(storedUsers, forKey: usersStorageKey)
    }

    private func getStoredAppleUser(appleId: String) async -> UserAccount? {
        let storedUsers = getStoredUsers()
        let key = "apple_\(appleId)"

        guard let userDict = storedUsers[key] as? [String: Any],
              let idString = userDict["id"] as? String,
              let id = UUID(uuidString: idString),
              let email = userDict["email"] as? String,
              let name = userDict["name"] as? String,
              let createdAtInterval = userDict["createdAt"] as? TimeInterval,
              let isPremium = userDict["isPremium"] as? Bool,
              let streakCount = userDict["streakCount"] as? Int,
              let totalReviews = userDict["totalReviews"] as? Int,
              let storedAppleId = userDict["appleId"] as? String else {
            return nil
        }

        return UserAccount(
            id: id,
            email: email,
            name: name,
            createdAt: Date(timeIntervalSince1970: createdAtInterval),
            isPremium: isPremium,
            streakCount: streakCount,
            totalReviews: totalReviews,
            appleId: storedAppleId
        )
    }

    // MARK: - User Profile Updates

    func updateUserProfile(name: String? = nil, isPremium: Bool? = nil) async {
        guard let currentUser = currentUser else { return }

        let updatedUser = UserAccount(
            id: currentUser.id,
            email: currentUser.email,
            name: name ?? currentUser.name,
            createdAt: currentUser.createdAt,
            isPremium: isPremium ?? currentUser.isPremium,
            streakCount: currentUser.streakCount,
            totalReviews: currentUser.totalReviews,
            appleId: currentUser.appleId
        )

        // Update stored user data
        var storedUsers = getStoredUsers()
        if var userDict = storedUsers[currentUser.email] as? [String: Any] {
            userDict["name"] = updatedUser.name
            userDict["isPremium"] = updatedUser.isPremium
            storedUsers[currentUser.email] = userDict
            UserDefaults.standard.set(storedUsers, forKey: usersStorageKey)
        }

        await MainActor.run {
            self.currentUser = updatedUser
            authState = .authenticated(updatedUser)
        }
    }

    func updateUserStats(streakCount: Int? = nil, totalReviews: Int? = nil) async {
        guard let currentUser = currentUser else { return }

        let updatedUser = UserAccount(
            id: currentUser.id,
            email: currentUser.email,
            name: currentUser.name,
            createdAt: currentUser.createdAt,
            isPremium: currentUser.isPremium,
            streakCount: streakCount ?? currentUser.streakCount,
            totalReviews: totalReviews ?? currentUser.totalReviews,
            appleId: currentUser.appleId
        )

        // Update stored user data
        var storedUsers = getStoredUsers()
        if var userDict = storedUsers[currentUser.email] as? [String: Any] {
            userDict["streakCount"] = updatedUser.streakCount
            userDict["totalReviews"] = updatedUser.totalReviews
            storedUsers[currentUser.email] = userDict
            UserDefaults.standard.set(storedUsers, forKey: usersStorageKey)
        }

        await MainActor.run {
            self.currentUser = updatedUser
            authState = .authenticated(updatedUser)
        }
    }
}
