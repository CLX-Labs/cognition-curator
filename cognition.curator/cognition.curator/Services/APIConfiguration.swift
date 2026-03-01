import Foundation

/**
 * Centralized API Configuration for Cognition Curator
 *
 * This configuration automatically switches between development and production
 * environments based on the build configuration.
 */

// MARK: - API Error Types (A2 Fix)

/// Unified error type for all API operations
enum APIError: Error, LocalizedError {
    case notAuthenticated           // No JWT token available
    case sessionExpired             // 401 from backend - token invalid/expired
    case serverError(Int, String)   // Non-2xx response
    case networkError(Error)        // Network/connection issues
    case decodingError(Error)       // JSON parsing failed
    case invalidURL                 // URL construction failed

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated. Please sign in."
        case .sessionExpired:
            return "Your session has expired. Please sign in again."
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Data error: \(error.localizedDescription)"
        case .invalidURL:
            return "Invalid URL configuration"
        }
    }
}

// MARK: - Notification Names for Session Events

extension Notification.Name {
    /// Posted when a 401 response is received - listeners should redirect to login
    static let sessionExpired = Notification.Name("sessionExpired")
}

struct APIConfiguration {

    // MARK: - Base URL Configuration

    #if DEBUG
    /// Development environment - connects to local Flask server
    static let baseURL = "http://127.0.0.1:5001/api"
    static let environment = "development"
    #else
    /// Production environment - connects to Railway deployment
    static let baseURL = "https://cognition-curator-production.up.railway.app/api"
    static let environment = "production"
    #endif

    // MARK: - Timeout Configuration

    /// Default timeout for most API requests (in seconds)
    static let defaultTimeoutInterval: TimeInterval = 60

    /// Extended timeout for authentication requests (in seconds)
    /// This is longer to account for cold starts and Apple token verification
    static let authTimeoutInterval: TimeInterval = 120

    /// Extended timeout for AI generation requests (in seconds)
    static let aiTimeoutInterval: TimeInterval = 180

    // MARK: - Custom URLSession Configurations

    /// URLSession configured for authentication requests with extended timeout
    static var authURLSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = authTimeoutInterval
        config.timeoutIntervalForResource = authTimeoutInterval
        return URLSession(configuration: config)
    }()

    /// URLSession configured for AI requests with extended timeout
    static var aiURLSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = aiTimeoutInterval
        config.timeoutIntervalForResource = aiTimeoutInterval
        return URLSession(configuration: config)
    }()

    // MARK: - Endpoint Paths

    struct Auth {
        static let profile = "/auth/profile"
        static let appleSignIn = "/auth/apple-signin"
        static let refresh = "/auth/refresh"
    }

    struct Decks {
        static let list = "/decks/"
        static let create = "/decks/"
        static func detail(_ id: String) -> String { "/decks/\(id)" }
    }

    struct Flashcards {
        static let create = "/flashcards/"
        static let batch = "/flashcards/batch"
        static func byDeck(_ deckId: String) -> String { "/flashcards/deck/\(deckId)" }
        static func detail(_ id: String) -> String { "/flashcards/\(id)" }
    }

    struct Analytics {
        static func dashboard(days: Int = 30) -> String { "/analytics/dashboard?days=\(days)" }
        static let syncStudySession = "/sync/study-session"
        static let syncFlashcardReview = "/sync/flashcard-review"
        static let syncUserStats = "/sync/user-stats"
    }

    struct AI {
        static let generateFlashcards = "/ai/generate-flashcards"
        static let generateAnswer = "/ai/generate-answer"
    }

    // MARK: - Helper Methods

    /// Get full URL for an endpoint path
    static func url(for path: String) -> String {
        return baseURL + path
    }

    /// Get URL object for an endpoint path
    static func urlObject(for path: String) -> URL? {
        return URL(string: url(for: path))
    }

    // MARK: - Configuration Info

    /// Print current configuration (useful for debugging)
    static func printConfiguration() {
        print("🔧 APIConfiguration: Environment = \(environment)")
        print("🔧 APIConfiguration: Base URL = \(baseURL)")
    }

    // MARK: - A2 Fix: Unified Response Handling

    /// Handle API response and throw appropriate errors for non-success status codes
    /// This should be called by all API services to ensure consistent error handling
    static func handleAPIResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }

        switch httpResponse.statusCode {
        case 200...299:
            // Success - do nothing
            return

        case 401:
            // Session expired - trigger sign out and notify listeners
            print("🔐 APIConfiguration: 401 Unauthorized - session expired")
            Task { @MainActor in
                AuthenticationService.shared.signOut()
                NotificationCenter.default.post(name: .sessionExpired, object: nil)
            }
            throw APIError.sessionExpired

        case 403:
            print("🔐 APIConfiguration: 403 Forbidden")
            throw APIError.serverError(403, "Access denied")

        case 404:
            print("🔐 APIConfiguration: 404 Not Found")
            let message = String(data: data, encoding: .utf8) ?? "Resource not found"
            throw APIError.serverError(404, message)

        case 500...599:
            print("❌ APIConfiguration: Server error \(httpResponse.statusCode)")
            let message = String(data: data, encoding: .utf8) ?? "Internal server error"
            throw APIError.serverError(httpResponse.statusCode, message)

        default:
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(httpResponse.statusCode, message)
        }
    }
}
