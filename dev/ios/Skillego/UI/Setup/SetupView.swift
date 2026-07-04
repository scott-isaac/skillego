import SwiftUI

struct SetupView: View {
    @Environment(AppState.self) private var appState

    @State private var numPlayers = 2
    @State private var playerTypes: [Int: String] = [1: "human", 2: "cpu", 3: "cpu", 4: "cpu"]
    @State private var playerDifficulties: [Int: String] = [1: "expert", 2: "expert", 3: "expert", 4: "expert"]
    @State private var enabledAbilities: Set<String> = ["push", "hop", "transform"]

    var body: some View {
        NavigationStack {
            Form {
                if let constants = appState.constants {
                    playersSection
                    abilitiesSection(constants: constants)
                } else if let error = appState.constantsError {
                    Section {
                        Text(error).foregroundStyle(.red)
                        Button("Retry") { Task { await appState.loadConstantsIfNeeded() } }
                    }
                } else {
                    ProgressView("Loading…")
                }
            }
            .navigationTitle("Skillego")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { start() }
                        .disabled(appState.constants == nil)
                }
            }
        }
    }

    private var playersSection: some View {
        Section("Players") {
            Picker("Player Count", selection: $numPlayers) {
                Text("2 Players").tag(2)
                Text("4 Players").tag(4)
            }
            .pickerStyle(.segmented)

            ForEach(1...numPlayers, id: \.self) { player in
                playerRow(player)
            }
        }
    }

    private func playerRow(_ player: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Player \(player)").font(.subheadline.bold())
            Picker("Player \(player) type", selection: Binding(
                get: { playerTypes[player] ?? "cpu" },
                set: { playerTypes[player] = $0 }
            )) {
                Text("Human").tag("human")
                Text("CPU").tag("cpu")
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if playerTypes[player] == "cpu" {
                Picker("Difficulty", selection: Binding(
                    get: { playerDifficulties[player] ?? "expert" },
                    set: { playerDifficulties[player] = $0 }
                )) {
                    Text("Easy").tag("easy")
                    Text("Medium").tag("medium")
                    Text("Hard").tag("hard")
                    Text("Expert").tag("expert")
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func abilitiesSection(constants: GameConstants) -> some View {
        Section("Abilities") {
            ForEach(constants.allAbilities) { ability in
                Toggle(isOn: Binding(
                    get: { enabledAbilities.contains(ability.id) },
                    set: { isOn in
                        if isOn { enabledAbilities.insert(ability.id) } else { enabledAbilities.remove(ability.id) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(ability.emoji) \(ability.name)")
                        Text(ability.description).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func start() {
        var players: [Int: PlayerConfig] = [:]
        for player in 1...numPlayers {
            let type = playerTypes[player] ?? "cpu"
            let difficulty = type == "cpu" ? (playerDifficulties[player] ?? "expert") : nil
            players[player] = PlayerConfig(type: type, difficulty: difficulty)
        }
        let config = GameSetupConfig(
            numPlayers: numPlayers,
            players: players,
            enabledAbilities: Array(enabledAbilities),
            cpuMoveDelayMs: 800
        )
        appState.startGame(config)
    }
}

#Preview {
    ContentView()
}
