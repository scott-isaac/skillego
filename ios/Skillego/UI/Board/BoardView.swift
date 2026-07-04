import SwiftUI

/// Sizes the board grid to fit whatever screen it's on via GeometryReader —
/// the native answer to the web version's fixed 1024x1536-with-CSS-scale
/// layout, which relied on the browser's own pinch-zoom for anything smaller.
/// Also adds a real pinch/pan gesture on the board itself (bounded, with a
/// double-tap reset) since a 9x8 four-player board can still get cramped on a
/// small phone even at best fit.
struct BoardView: View {
    let viewModel: GameSessionViewModel

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            if let snapshot = viewModel.snapshot {
                let rows = snapshot.board.count
                let cols = snapshot.board.first?.count ?? 1
                let cellSize = min(geo.size.width / CGFloat(cols), geo.size.height / CGFloat(rows))

                grid(snapshot: snapshot, rows: rows, cols: cols, cellSize: cellSize)
                    .frame(width: cellSize * CGFloat(cols), height: cellSize * CGFloat(rows))
                    .scaleEffect(scale)
                    .offset(offset)
                    .position(x: geo.size.width / 2, y: cellSize * CGFloat(rows) / 2)
                    .gesture(magnifyAndDragGesture)
                    .onTapGesture(count: 2) {
                        withAnimation { scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero }
                    }
            } else {
                ProgressView()
                    .frame(width: geo.size.width, height: geo.size.height)
            }
        }
    }

    private func grid(snapshot: GameSnapshot, rows: Int, cols: Int, cellSize: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(0..<cols, id: \.self) { col in
                        CellView(
                            piece: snapshot.board[row][col],
                            covered: snapshot.covered[row][col],
                            tileIndex: viewModel.tileIndices[safe: row]?[safe: col] ?? 1,
                            spriteKey: viewModel.spriteKeys[safe: row]?[safe: col] ?? nil,
                            isSelected: viewModel.isSelected(row: row, col: col),
                            isValidDestination: viewModel.isValidDestination(row: row, col: col)
                        )
                        .frame(width: cellSize, height: cellSize)
                        .onTapGesture { viewModel.tapCell(row: row, col: col) }
                        .accessibilityIdentifier("cell_\(row)_\(col)")
                    }
                }
            }
        }
    }

    private var magnifyAndDragGesture: some Gesture {
        SimultaneousGesture(
            MagnificationGesture()
                .onChanged { value in scale = min(max(lastScale * value, 1), 3) }
                .onEnded { _ in lastScale = scale },
            DragGesture()
                .onChanged { value in
                    guard scale > 1 else { return }
                    offset = CGSize(
                        width: lastOffset.width + value.translation.width,
                        height: lastOffset.height + value.translation.height
                    )
                }
                .onEnded { _ in lastOffset = offset }
        )
    }
}
