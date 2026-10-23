import AuthenticationServices
import Capacitor
import UIKit

@objc(NativeAuthSessionPlugin)
public final class NativeAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "NativeAuthSessionPlugin"
    public let jsName = "NativeAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private var gate = NativeAuthCallbackGate()
    private var session: ASWebAuthenticationSession?
    private var pendingCall: CAPPluginCall?
    private var anchor: ASPresentationAnchor?

    @objc func authenticate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Sign-in is unavailable."); return }
            guard let raw = call.getString("url"), let url = URL(string: raw),
                  url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
                  url.fragment == nil, url.path == "/auth/v1/authorize",
                  let id = call.getString("attemptId"), NativeAuthCallbackGate.validAttemptID(id),
                  let window = self.bridge?.viewController?.view.window else {
                call.reject("Sign-in could not be started.")
                return
            }
            self.cancelActive()
            guard let attempt = self.gate.begin(id) else { call.reject("Invalid sign-in attempt."); return }
            self.pendingCall = call
            self.anchor = window
            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callback, error in
                DispatchQueue.main.async {
                    guard let self, self.gate.active == attempt else { return }
                    let accepted = callback.map { self.gate.consume($0, for: attempt) } ?? false
                    if !accepted { _ = self.gate.cancel(attempt) }
                    let pending = self.pendingCall
                    self.pendingCall = nil
                    self.session = nil
                    self.anchor = nil
                    if error == nil, accepted, let callback {
                        pending?.resolve(["url": callback.absoluteString])
                    } else {
                        // Do not include the callback, code, provider errors, or tokens in diagnostics.
                        pending?.reject("Sign-in was cancelled or could not be completed.")
                    }
                }
            }
            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(url: url, callback: .customScheme("pubmaxx"), completionHandler: completion)
            } else {
                session = ASWebAuthenticationSession(url: url, callbackURLScheme: "pubmaxx", completionHandler: completion)
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() { self.cancelActive() }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let self, call.getString("attemptId") == self.gate.active?.id { self.cancelActive() }
            call.resolve()
        }
    }

    private func cancelActive() {
        if let active = gate.active { _ = gate.cancel(active) }
        let oldSession = session
        let oldCall = pendingCall
        session = nil
        pendingCall = nil
        anchor = nil
        oldSession?.cancel()
        oldCall?.reject("Sign-in was cancelled.")
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // authenticate requires an attached window and retains it until completion.
        anchor ?? ASPresentationAnchor()
    }
}
