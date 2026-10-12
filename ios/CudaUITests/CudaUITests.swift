import XCTest

final class CudaUITests: XCTestCase {
    func testShelfPlayerAndLocalAudio() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchEnvironment["CUDA_DEMO"] = "1"; app.launch()
        XCTAssertTrue(app.navigationBars["Cuda"].waitForExistence(timeout: 10))
        let song = app.buttons["Play Blue hour, Cuda Sessions"].firstMatch
        XCTAssertTrue(song.waitForExistence(timeout: 10)); song.tap()
        let play = app.buttons["mini-play"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        let pausePredicate = NSPredicate(format: "label == %@", "Pause")
        expectation(for: pausePredicate, evaluatedWith: play)
        waitForExpectations(timeout: 15)
        app.buttons["Open now playing"].tap()
        XCTAssertTrue(app.navigationBars["Now playing"].waitForExistence(timeout: 5))
        app.buttons["Favourite"].tap()
        app.swipeUp()
        let audio = app.buttons["audio-settings"]
        XCTAssertTrue(audio.waitForExistence(timeout: 5)); audio.tap()
        XCTAssertTrue(app.navigationBars["Audio"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["Equalizer"].exists)
        XCTAssertTrue(app.sliders["Playback speed"].exists)
        app.navigationBars["Audio"].buttons["Done"].tap()
        app.navigationBars["Now playing"].buttons["Done"].tap()
        app.tabBars.buttons["Shelf"].tap()
        XCTAssertTrue(app.navigationBars["Shelf"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Playlists"].exists)
    }
}
