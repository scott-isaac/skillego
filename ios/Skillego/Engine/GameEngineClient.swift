import Foundation

/// Backs both local (JavaScriptCore) and online (Socket.IO) play behind one
/// interface so the SwiftUI/view-model layer never branches on which is driving
/// a given game — it just talks to whatever `GameEngineClient` it was handed.
protocol GameEngineClient: AnyObject {
    // Setup / lifecycle
    func startLocalGame(_ config: GameSetupConfig) async throws -> GameSnapshot
    func createOnlineGame(_ config: GameSetupConfig) async throws -> (gameId: String, playerNumber: Int?)
    func joinOnlineGame(code: String) async throws -> (gameId: String, playerNumber: Int)
    func rejoin() async throws -> GameSnapshot?           // no-op for LocalEngine

    // Query — used to drive selection highlighting. LocalEngine answers this
    // directly against local state; RemoteEngine returns [] since the server
    // doesn't expose pre-validation (the app trusts the server's response to
    // submitMove, same as the web client already does).
    func availableDestinations(row: Int, col: Int) async -> [GameMove]

    // Actions
    func submitMove(_ move: GameMove) async throws
    func resign() async throws
    func leaveGame() async throws
    func requestRematch() async throws

    // Continuous state
    var snapshots: AsyncStream<GameSnapshot> { get }
    var events: AsyncStream<GameEngineEvent> { get }
}

enum GameEngineError: Error {
    case notConnected
    case invalidResponse(String)
    case jsException(String)
}
