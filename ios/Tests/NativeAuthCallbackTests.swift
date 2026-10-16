import Foundation

@main
struct NativeAuthCallbackTests {
    static func main() {
        let id = String(repeating: "a", count: 32)
        let callback = URL(string: "pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=\(id)#")!
        var gate = NativeAuthCallbackGate()
        precondition(gate.begin("invalid") == nil)
        let first = gate.begin(id)!
        precondition(gate.consume(callback, for: first))
        precondition(!gate.consume(callback, for: first), "replayed callback")
        let cancelled = gate.begin(id)!
        precondition(gate.cancel(cancelled))
        precondition(!gate.consume(callback, for: cancelled), "cancelled callback")
        let replaced = gate.begin(id)!
        let replacement = gate.begin(id)!
        precondition(!gate.consume(callback, for: replaced), "superseded completion")
        precondition(gate.active == replacement)
        precondition(gate.consume(callback, for: replacement))
        for raw in [
            "pubmaxx://native-auth/callback?code=abc&_authAttempt=wrong",
            "pubmaxx://native-auth/callback?code=abc&_authAttempt=\(id)#access_token=secret",
            "pubmaxx://native-auth/callback?code=abc&_authAttempt=\(id)&refresh_token=secret",
            "pubmaxx://native-auth/callback?code=abc&code=replayed&_authAttempt=\(id)",
            "pubmaxx://native-auth/callback?code=abc&_authAttempt=\(id)&_authAttempt=\(id)",
            "pubmaxx://native-auth/callback?code=abc%0A&_authAttempt=\(id)",
            "pubmaxx://native-auth/callback?code=\(String(repeating: "a", count: 2049))&_authAttempt=\(id)",
            "pubmaxx://native-auth/callback?code=&_authAttempt=\(id)",
            "pubmaxx://native-auth/callback?_authAttempt=\(id)",
            "pubmaxx://user@native-auth/callback?code=abc&_authAttempt=\(id)",
            "pubmaxx://native-auth:123/callback?code=abc&_authAttempt=\(id)",
            "pubmaxx://auth/callback?code=abc&_authAttempt=\(id)",
            "https://pubmaxxing.com/auth/callback?code=abc&_authAttempt=\(id)"
        ] {
            let attempt = gate.begin(id)!
            precondition(!gate.consume(URL(string: raw)!, for: attempt), "invalid callback accepted")
            precondition(gate.active == nil, "invalid callback must release its own session")
        }
        print("Native callback ownership, cancellation, supersession and replay checks passed.")
    }
}
