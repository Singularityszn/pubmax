import Foundation

// Run with the Foundation-only policy file. These checks do not claim WebView proof.
@main
struct OfflineNavigationTests {
    static func main() {
        let local = URL(string: "http://localhost:3491/")!
        let production = URL(string: "https://pubmaxxing.com/")!
        let offline = URL(string: "capacitor://localhost/offline.html")!
        let launch = URL(string: "http://localhost:3491/app-entry")!
        let failed = URL(string: "http://localhost:3491/places?area=soho#pubs")!
        var retry = OfflineRetryDestination(serverURL: local, launchURL: launch, errorURL: offline)
        retry.pageStarted(failed)
        retry.recordFailure(URL(string: "http://localhost:3491/places?area=soho")!)
        retry.pageStarted(offline)
        precondition(retry.retryTarget(currentURL: offline, requestedURL: production) == failed)
        precondition(retry.retryTarget(currentURL: offline, requestedURL: production) == launch)
        precondition(retry.retryTarget(currentURL: failed, requestedURL: production) == nil)
        precondition(retry.retryTarget(currentURL: offline, requestedURL: URL(string: "https://example.com/")!) == nil)

        for unsafe in [
            "http://localhost:3492/places", "https://localhost:3491/places",
            "http://localhost:3491@evil.test/places", "http://user@localhost:3491/places",
            "http://localhost:3491/auth/callback?code=secret",
            "http://localhost:3491/auth/%63allback", "http://localhost:3491/other/../auth/callback",
            "http://localhost:3491/places?%63ode=secret", "http://localhost:3491/places#access_token=secret",
            "http://localhost:3491/places?_authCallback=1", "http://localhost:3491/places?token_hash=secret",
        ] {
            retry.recordFailure(URL(string: unsafe)!)
            precondition(retry.retryTarget(currentURL: offline, requestedURL: production) == launch, unsafe)
        }
        retry.recordFailure(failed)
        retry.pageStarted(URL(string: "http://localhost:3491/tonight")!)
        precondition(retry.retryTarget(currentURL: offline, requestedURL: production) == launch)

        var shipped = OfflineRetryDestination(serverURL: production, launchURL: production.appendingPathComponent("app-entry"), errorURL: offline)
        let plan = URL(string: "https://pubmaxxing.com/plan/test?view=route#stops")!
        shipped.pageStarted(plan)
        shipped.recordFailure(URL(string: "https://pubmaxxing.com/plan/test?view=route")!)
        precondition(shipped.retryTarget(currentURL: offline, requestedURL: production) == plan)

        precondition(OfflineNavigation.isCancellation(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
        precondition(!OfflineNavigation.isConnectivityFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
        for code in [NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
                     NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed, NSURLErrorNotConnectedToInternet] {
            precondition(OfflineNavigation.isConnectivityFailure(NSError(domain: NSURLErrorDomain, code: code)))
        }
        precondition(!OfflineNavigation.isConnectivityFailure(NSError(domain: "WKErrorDomain", code: 102)))
        precondition(!OfflineNavigation.isConnectivityFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorServerCertificateUntrusted)))
        print("Offline navigation policy checks passed")
    }
}
