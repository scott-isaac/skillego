import Foundation
import Observation

/// App-wide root: owns the single JSContextHost/LocalEngine for the process
/// lifetime (spinning up JavaScriptCore per game would be wasteful) and drives
/// top-level navigation between setup and an active game.
@Observable
final class AppState {
    let localEngine: LocalEngine
    var constants: GameConstants?
    var constantsError: String?
    var route: Route = .setup

    enum Route: Equatable {
        case setup
        case playing(GameSetupConfig)
    }

    init() {
        localEngine = LocalEngine()
    }

    func loadConstantsIfNeeded() async {
        guard constants == nil else { return }
        do {
            constants = try await localEngine.loadConstants()
            constantsError = nil
        } catch {
            constantsError = "Couldn't load game data: \(error)"
        }
    }

    func startGame(_ config: GameSetupConfig) {
        route = .playing(config)
    }

    func returnToSetup() {
        route = .setup
    }
}
