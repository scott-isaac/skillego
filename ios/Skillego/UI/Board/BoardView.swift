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

    // board.png's native frame size + grid inset, taken directly from
    // styles.css's #board-frame (1024x1536) / #board (left:158 top:314 690x690).
    // 2-player (6x6) only — 4-player mode drops the art in the web app too,
    // since it's sized for a 6x6 layout (styles.css's #board-frame.mode-4p).
    private let frameSize = CGSize(width: 1024, height: 1536)
    private let gridInset = CGRect(x: 158, y: 314, width: 690, height: 690)

    var body: some View {
        GeometryReader { geo in
            if let snapshot = viewModel.snapshot {
                let rows = snapshot.board.count
                let cols = snapshot.board.first?.count ?? 1

                if rows == 6, cols == 6, GameAssetImage.boardFrame != nil {
                    decorativeBoard(geo: geo, snapshot: snapshot, rows: rows, cols: cols)
                } else {
                    plainBoard(geo: geo, snapshot: snapshot, rows: rows, cols: cols)
                }
            } else {
                ProgressView()
                    .frame(width: geo.size.width, height: geo.size.height)
            }
        }
    }

    @ViewBuilder
    private func decorativeBoard(geo: GeometryProxy, snapshot: GameSnapshot, rows: Int, cols: Int) -> some View {
        let frameW = min(geo.size.width, geo.size.height * frameSize.width / frameSize.height)
        let frameH = frameW * frameSize.height / frameSize.width
        let frameScale = frameW / frameSize.width
        let cellSize = (gridInset.width * frameScale) / CGFloat(cols)

        ZStack(alignment: .topLeading) {
            if let boardImage = GameAssetImage.boardFrame {
                Image(uiImage: boardImage).resizable().frame(width: frameW, height: frameH)
            }
            grid(snapshot: snapshot, rows: rows, cols: cols, cellSize: cellSize)
                .frame(width: cellSize * CGFloat(cols), height: cellSize * CGFloat(rows))
                .offset(x: gridInset.minX * frameScale, y: gridInset.minY * frameScale)
        }
        .frame(width: frameW, height: frameH)
        .scaleEffect(scale)
        .offset(offset)
        .position(x: geo.size.width / 2, y: frameH / 2)
        .gesture(magnifyAndDragGesture)
        .onTapGesture(count: 2) { resetZoom() }
    }

    @ViewBuilder
    private func plainBoard(geo: GeometryProxy, snapshot: GameSnapshot, rows: Int, cols: Int) -> some View {
        let cellSize = min(geo.size.width / CGFloat(cols), geo.size.height / CGFloat(rows))
        grid(snapshot: snapshot, rows: rows, cols: cols, cellSize: cellSize)
            .frame(width: cellSize * CGFloat(cols), height: cellSize * CGFloat(rows))
            .scaleEffect(scale)
            .offset(offset)
            .position(x: geo.size.width / 2, y: cellSize * CGFloat(rows) / 2)
            .gesture(magnifyAndDragGesture)
            .onTapGesture(count: 2) { resetZoom() }
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

    private func resetZoom() {
        withAnimation {
            scale = 1; lastScale = 1
            offset = .zero; lastOffset = .zero
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
