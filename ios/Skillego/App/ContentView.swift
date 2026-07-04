import SwiftUI

// Placeholder root view — replaced by SetupView once the local-engine slice
// (JSContext core + fixture tests) is verified. See the iOS build-order plan.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Skillego").font(.largeTitle.bold())
            Text("iOS engine bring-up in progress").foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
