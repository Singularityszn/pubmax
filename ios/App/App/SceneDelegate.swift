import UIKit
import Capacitor

// The UIScene entry point. iOS 27 refuses to launch an app that has not adopted
// the scene lifecycle (EXC_BREAKPOINT in UIKitCore's
// ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke),
// so the app's window, its URL opens and its universal links live here rather
// than on AppDelegate. This is Capacitor 8.5's own template, kept in its own
// file as the Capacitor guide asks. `UIApplicationSceneManifest` in Info.plist
// names this class.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // The manifest's UISceneStoryboardFile makes UIKit build the window from
        // Main.storyboard (a CAPBridgeViewController) and assign it to `window`
        // before this runs. Only build one by hand when it did not, so the
        // bridge is never created twice.
        if window == nil {
            window = UIWindow(windowScene: windowScene)
            window?.rootViewController = CAPBridgeViewController()
            window?.makeKeyAndVisible()
        }

        // Capacitor queues a cold-start URL or user activity until the bridge
        // view has appeared, then delivers it to the App plugin.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // pubmaxx:// links and any other custom-scheme open while the app runs.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    // Universal links (applinks:pubmaxxing.com).
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
