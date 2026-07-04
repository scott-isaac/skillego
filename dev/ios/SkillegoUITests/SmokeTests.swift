import XCTest

/// Drives the real app through the local-play golden path (setup -> start ->
/// tap a cell to uncover it) and attaches screenshots at each step. This is
/// the practical way to verify SwiftUI layout/rendering and tap interaction
/// actually work, since headless unit tests can't see the board render.
final class SmokeTests: XCTestCase {
    func testSetupToBoard() {
        let app = XCUIApplication()
        app.launch()

        let startButton = app.buttons["Start"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10), "Setup screen never became interactive")
        attach(app, name: "01-setup")

        startButton.tap()

        let firstCell = app.descendants(matching: .any).matching(identifier: "cell_0_0").firstMatch
        XCTAssertTrue(firstCell.waitForExistence(timeout: 10), "Board never appeared after Start")
        attach(app, name: "02-board-initial")

        firstCell.tap()
        // Let the uncover animation/state update settle before capturing.
        Thread.sleep(forTimeInterval: 1)
        attach(app, name: "03-after-uncover-tap")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
