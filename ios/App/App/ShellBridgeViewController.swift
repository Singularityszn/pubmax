import UIKit
import WebKit
import Capacitor

final class ShellBridgeViewController: CAPBridgeViewController, UIGestureRecognizerDelegate {
    private var shellNavigation: ShellNavigationDelegate?
    private var edgeBackGesture: UIScreenEdgePanGestureRecognizer?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView, let bridge = bridge,
              let original = webView.navigationDelegate, let errorURL = bridge.config.errorPathURL else { return }
        // Capacitor owns the bridge, UI delegate and scroll delegate. Its loadView is final.
        let navigation = ShellNavigationDelegate(original: original, config: bridge.config,
                                                 errorURL: errorURL, initialOpacity: webView.isOpaque)
        shellNavigation = navigation
        webView.navigationDelegate = navigation
        // WebKit's gesture can leave SPA history unchanged. Send one Back through
        // the site's existing panel-first policy instead, with no competing swipe.
        webView.allowsBackForwardNavigationGestures = false
        let edgeBack = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgeBack(_:)))
        edgeBack.edges = .left
        edgeBack.maximumNumberOfTouches = 1
        edgeBack.delegate = self
        edgeBackGesture = edgeBack
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard let window = webView?.window, let edgeBack = edgeBackGesture else { return }
        if edgeBack.view !== window { window.addGestureRecognizer(edgeBack) }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard presentedViewController == nil, let pan = gestureRecognizer as? UIPanGestureRecognizer,
              let webView = webView else { return false }
        let originX = pan.location(in: webView).x - pan.translation(in: webView).x
        let velocity = pan.velocity(in: webView)
        return originX >= 0 && originX <= 24 && velocity.x > abs(velocity.y)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func handleEdgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended, let webView = webView else { return }
        let distance = gesture.translation(in: webView).x
        let velocity = gesture.velocity(in: webView).x
        guard distance >= 80 || (distance >= 20 && velocity >= 500) else { return }
        if let errorURL = bridge?.config.errorPathURL, webView.url == errorURL {
            if webView.canGoBack { webView.goBack() }
            return
        }
        let canGoBack = webView.canGoBack ? "true" : "false"
        bridge?.eval(js: "window.dispatchEvent(new CustomEvent('pubmax:ios-back', { detail: { canGoBack: \(canGoBack) } }))")
    }
}

// Forward every other optional callback to Capacitor, including permissions and plugins.
private final class ShellNavigationDelegate: NSObject, WKNavigationDelegate {
    private let original: WKNavigationDelegate
    private let errorURL: URL
    private let initialOpacity: Bool
    private var activeNavigation: WKNavigation?
    private var retry: OfflineRetryDestination

    init(original: WKNavigationDelegate, config: InstanceConfiguration, errorURL: URL, initialOpacity: Bool) {
        self.original = original
        self.errorURL = errorURL
        self.initialOpacity = initialOpacity
        self.retry = OfflineRetryDestination(serverURL: config.serverURL,
                                              launchURL: config.appStartServerURL,
                                              errorURL: errorURL)
        super.init()
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || original.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        original.responds(to: selector) ? original : super.forwardingTarget(for: selector)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        activeNavigation = navigation
        // Keep the visible document's plugin listeners until its replacement commits.
        // Capacitor resets them in didStart, which also runs for a cancelled load.
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        original.webView?(webView, didStartProvisionalNavigation: navigation)
        original.webView?(webView, didCommit: navigation)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true,
           let url = navigationAction.request.url,
           let target = retry.retryTarget(currentURL: webView.url, requestedURL: url) {
            decisionHandler(.cancel)
            // Replace the bundled page so Back cannot return to an obsolete outage.
            guard let encoded = try? JSONSerialization.data(withJSONObject: [target.absoluteString]),
                  let argument = String(data: encoded, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                webView.evaluateJavaScript("location.replace(\(argument)[0])", completionHandler: nil)
            }
            return
        }
        let decide: (WKNavigationActionPolicy) -> Void = { [weak self] policy in
            if policy == .allow, navigationAction.targetFrame?.isMainFrame == true,
               let url = navigationAction.request.url {
                self?.retry.pageStarted(url)
            }
            decisionHandler(policy)
        }
        if original.responds(to: #selector(ShellNavigationDelegate.webView(_:decidePolicyFor:decisionHandler:))) {
            original.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decide)
        } else {
            decide(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(webView, navigation: navigation, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(webView, navigation: navigation, error: error)
    }

    private func handleFailure(_ webView: WKWebView, navigation: WKNavigation?, error: Error) {
        let failure = error as NSError
        guard !OfflineNavigation.isCancellation(failure) else { return }
        guard navigation === activeNavigation else { return }
        // Restore Capacitor's first-load opacity without its unconditional error-page load.
        webView.isOpaque = initialOpacity
        guard OfflineNavigation.isConnectivityFailure(failure) else {
            CAPLog.print("WebView navigation failed: \(failure.domain) \(failure.code)")
            return
        }
        let failed = (failure.userInfo[NSURLErrorFailingURLErrorKey] as? URL)
            ?? (failure.userInfo[NSURLErrorFailingURLStringErrorKey] as? String).flatMap(URL.init(string:))
        retry.recordFailure(failed)
        webView.load(URLRequest(url: errorURL))
    }
}
