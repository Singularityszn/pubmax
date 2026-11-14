import Capacitor
import CoreMotion

/// Totals the steps Core Motion recorded between two times. The system keeps that
/// record for about seven days, so a total survives suspension, termination and reboot.
@objc(OutingStepsPlugin)
public final class OutingStepsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OutingStepsPlugin"
    public let jsName = "OutingSteps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sample", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let pedometer = CMPedometer()
    private static let maxSpan: TimeInterval = 12 * 60 * 60
    private static let historyLimit: TimeInterval = 7 * 24 * 60 * 60

    private static func statusPayload() -> [String: Any] {
        let permission: String
        switch CMPedometer.authorizationStatus() {
        case .authorized: permission = "granted"
        case .notDetermined: permission = "prompt"
        default: permission = "denied"
        }
        return ["available": CMPedometer.isStepCountingAvailable(), "permission": permission]
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(Self.statusPayload())
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        guard CMPedometer.isStepCountingAvailable(), CMPedometer.authorizationStatus() == .notDetermined else {
            call.resolve(Self.statusPayload())
            return
        }
        // Core Motion has no request call. The first query shows the system prompt.
        let now = Date()
        pedometer.queryPedometerData(from: now.addingTimeInterval(-60), to: now) { _, _ in
            DispatchQueue.main.async { call.resolve(Self.statusPayload()) }
        }
    }

    @objc func sample(_ call: CAPPluginCall) {
        let now = Date()
        guard let sinceMs = call.getDouble("since"), let untilMs = call.getDouble("until") else {
            call.reject("A step window needs a start and an end.", "invalid")
            return
        }
        let since = Date(timeIntervalSince1970: sinceMs / 1000)
        let until = Date(timeIntervalSince1970: untilMs / 1000)
        guard until >= since, until.timeIntervalSince(since) <= Self.maxSpan + 1,
              until <= now.addingTimeInterval(60), now.timeIntervalSince(since) <= Self.historyLimit else {
            call.reject("That step window cannot be read.", "invalid")
            return
        }
        guard CMPedometer.isStepCountingAvailable() else {
            call.reject("This phone does not count steps.", "unavailable")
            return
        }
        guard CMPedometer.authorizationStatus() == .authorized else {
            call.reject("Motion access is off.", "denied")
            return
        }
        pedometer.queryPedometerData(from: since, to: until) { data, error in
            DispatchQueue.main.async {
                if let error = error as NSError? {
                    let denied = error.domain == CMErrorDomain && error.code == Int(CMErrorMotionActivityNotAuthorized.rawValue)
                    call.reject(denied ? "Motion access is off." : "Steps could not be read.", denied ? "denied" : "failed")
                    return
                }
                call.resolve(["platform": "ios", "steps": data?.numberOfSteps.intValue ?? 0])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        // Nothing listens between readings on iOS, so there is nothing to release.
        call.resolve()
    }
}
