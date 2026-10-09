import XCTest
final class OfflineBackUITests: XCTestCase {
    func testOutageBack() {
        let app = XCUIApplication(bundleIdentifier: "com.pubmaxx.app")
        app.launch()
        XCTAssertTrue(app.staticTexts["Healthy review document"].waitForExistence(timeout: 20))
        app.buttons["Fail main frame"].tap()
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 10))
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "outage-before-edge"
        before.lifetime = .keepAlways
        add(before)
        let web = app.webViews.firstMatch
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45)).press(forDuration: 0.1, thenDragTo: web.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45)), withVelocity: 500, thenHoldForDuration: 0)
        XCTAssertTrue(app.staticTexts["Healthy review document"].waitForExistence(timeout: 5), "Edge Back must leave the bundled outage document for existing healthy history")
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "outage-after-edge"
        after.lifetime = .keepAlways
        add(after)
    }
}
