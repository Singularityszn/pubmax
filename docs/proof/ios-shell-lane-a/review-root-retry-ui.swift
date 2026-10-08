import XCTest
final class RootRetryUITests: XCTestCase {
    private func fixture() -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: "com.pubmaxx.app")
        app.launchEnvironment["DYLD_INSERT_LIBRARIES"] = "/Users/karanmanoharan/.no-mistakes/worktrees/0a94b5a8763e/01M4DPQ7VDX0VCH2M4H1WTC2TX/ios/build/root-retry-review/RootFixture.dylib"
        app.launch()
        XCTAssertTrue(app.staticTexts["Healthy production homepage"].waitForExistence(timeout: 20))
        app.buttons["Fail root reload"].tap()
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 10))
        return app
    }
    private func assertHomepage(_ app: XCUIApplication) {
        let ok = app.staticTexts["Healthy production homepage"].waitForExistence(timeout: 5)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "production-root-destination"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertTrue(ok, "Recovery must restore the production homepage, not app-entry")
    }
    func testProductionRootBack() {
        let app = fixture()
        let web = app.webViews.firstMatch
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45)).press(forDuration: 0.1, thenDragTo: web.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45)), withVelocity: 500, thenHoldForDuration: 0)
        assertHomepage(app)
    }
    func testProductionRootRetry() {
        let app = fixture()
        app.buttons["Try again"].tap()
        assertHomepage(app)
    }
}
