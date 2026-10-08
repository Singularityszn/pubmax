import Foundation

enum OfflineNavigation {
    static func isCancellation(_ error: NSError) -> Bool {
        error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled
    }

    static func isConnectivityFailure(_ error: NSError) -> Bool {
        guard error.domain == NSURLErrorDomain else { return false }
        return [NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
                NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed,
                NSURLErrorNotConnectedToInternet].contains(error.code)
    }
}

// One failed document, in memory. Authentication callbacks must never be replayed.
struct OfflineRetryDestination {
    let serverURL: URL
    let launchURL: URL
    let errorURL: URL
    private var failedURL: URL?
    private var navigationURL: URL?
    private let credentialKeys: Set<String> = [
        "code", "access_token", "refresh_token", "id_token", "token", "token_hash",
        "authorization_code", "provider_token", "provider_refresh_token", "error_description",
        "_authcallback", "_authattempt", "_referralsignupproof"
    ]

    init(serverURL: URL, launchURL: URL, errorURL: URL) {
        self.serverURL = serverURL
        self.launchURL = launchURL
        self.errorURL = errorURL
    }

    mutating func pageStarted(_ url: URL) {
        guard url != errorURL else { return }
        navigationURL = url
        failedURL = nil
    }

    mutating func recordFailure(_ url: URL?) {
        let candidate = sameDocument(url, navigationURL) ? navigationURL : url
        failedURL = candidate.flatMap { isSafe($0) ? $0 : nil }
    }

    mutating func retryTarget(currentURL: URL?, requestedURL: URL) -> URL? {
        guard currentURL == errorURL,
              sameOrigin(requestedURL, URL(string: "https://pubmaxxing.com/")!),
              requestedURL.path.isEmpty || requestedURL.path == "/",
              requestedURL.query == nil, requestedURL.fragment == nil else { return nil }
        let target = failedURL ?? launchURL
        failedURL = nil
        return target
    }

    private func isSafe(_ url: URL) -> Bool {
        guard sameOrigin(url, serverURL), url != errorURL else { return false }
        let path = url.standardized.path.lowercased()
        guard path != "/auth/callback", !path.hasPrefix("/auth/callback/") else { return false }
        return !hasCredential(url.query) && !hasCredential(url.fragment)
    }

    private func hasCredential(_ parameters: String?) -> Bool {
        guard let parameters = parameters else { return false }
        for parameter in parameters.components(separatedBy: CharacterSet(charactersIn: "&;")) {
            let key = parameter.components(separatedBy: "=")[0].replacingOccurrences(of: "+", with: " ")
            guard let decoded = key.removingPercentEncoding else { return true }
            if credentialKeys.contains(decoded.lowercased()) { return true }
        }
        return false
    }

    private func sameDocument(_ left: URL?, _ right: URL?) -> Bool {
        guard let left = left, let right = right else { return false }
        return sameOrigin(left, right) && left.path == right.path && left.query == right.query
    }

    private func sameOrigin(_ left: URL, _ right: URL) -> Bool {
        guard let scheme = left.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = left.host?.lowercased(), left.user == nil, left.password == nil else { return false }
        return scheme == right.scheme?.lowercased() && host == right.host?.lowercased()
            && (left.port ?? (scheme == "https" ? 443 : 80))
                == (right.port ?? (right.scheme?.lowercased() == "https" ? 443 : 80))
    }
}
