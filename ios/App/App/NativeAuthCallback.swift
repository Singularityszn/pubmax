import Foundation

/// One retained authentication session owns one callback. App URL events cannot claim it.
struct NativeAuthCallbackGate {
    struct Attempt: Equatable {
        let id: String
        let ticket: UUID
    }
    private(set) var active: Attempt?

    static func validAttemptID(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    mutating func begin(_ id: String) -> Attempt? {
        guard Self.validAttemptID(id) else { return nil }
        let attempt = Attempt(id: id, ticket: UUID())
        active = attempt
        return attempt
    }

    mutating func cancel(_ attempt: Attempt) -> Bool {
        guard active == attempt else { return false }
        active = nil
        return true
    }

    mutating func consume(_ url: URL, for attempt: Attempt) -> Bool {
        guard active == attempt else { return false }
        active = nil
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "pubmaxx", parts.host == "native-auth", parts.percentEncodedPath == "/callback",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.fragment == nil || parts.fragment == "" else { return false }
        let items = parts.queryItems ?? []
        guard items.count == 2,
              items.filter({ $0.name == "_authAttempt" }).count == 1,
              items.filter({ $0.name == "code" }).count == 1,
              items.first(where: { $0.name == "_authAttempt" })?.value == attempt.id,
              let code = items.first(where: { $0.name == "code" })?.value,
              (1...2048).contains(code.utf8.count) else { return false }
        return code.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95
        }
    }
}
