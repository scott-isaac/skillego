import SwiftUI

/// Renders the board two ways depending on mode:
///
/// - 2-player (6x6): the web app's ornate board.png frame, zoomed in relative
///   to the web version — only ~1 tile's width of decorative margin left/right
///   instead of the full frame — with the turn indicator and skill tray
///   overlaid directly onto the frame's baked-in red bar and 5-slot bracket
///   (see the pixel measurements below) rather than living in separate bars.
///   The frame is scaled off its width, so it naturally runs taller than the
///   screen; the excess (mostly the bottom "steps" decoration) is clipped
///   rather than shrunk to fit, which is what keeps the grid itself large.
/// - 4-player (9x8): board.png doesn't fit that aspect ratio (same as the web
///   app's `#board-frame.mode-4p` fallback), so this keeps a plain grid with
///   separate header/footer bars.
///
/// Either way, sizing happens via GeometryReader so it adapts to any screen,
/// plus a real pinch/pan gesture (bounded, double-tap to reset) as a fallback
/// for anything still cramped, since there's no browser pinch-zoom on native.
struct BoardView: View {
    let viewModel: GameSessionViewModel
    let playerColors: [String: String]

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    // Pixel-measured against assets/board.png (1024x1536) — see the iOS UI
    // pass that introduced this for how these were derived.
    private let frameSize = CGSize(width: 1024, height: 1536)
    private let gridInset = CGRect(x: 158, y: 314, width: 690, height: 690)
    private let redBarRect = CGRect(x: 215, y: 215, width: 680, height: 75)
    private let slotRowRect = CGRect(x: 232, y: 1035, width: 518, height: 100)
    private let contentTopY: CGFloat = 190 // just above the red bar; crops the logo banner above it
    private let marginTiles: CGFloat = 1

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
        .background(Color.black)
    }

    @ViewBuilder
    private func decorativeBoard(geo: GeometryProxy, snapshot: GameSnapshot, rows: Int, cols: Int) -> some View {
        let tileWidthOriginal = gridInset.width / CGFloat(cols)
        let visibleLeft = gridInset.minX - marginTiles * tileWidthOriginal
        let visibleRight = gridInset.maxX + marginTiles * tileWidthOriginal
        let frameScale = geo.size.width / (visibleRight - visibleLeft)
        let fullW = frameSize.width * frameScale
        let fullH = frameSize.height * frameScale
        let originX = -visibleLeft * frameScale
        let originY = -contentTopY * frameScale
        let cellSize = tileWidthOriginal * frameScale

        ZStack(alignment: .topLeading) {
            if let boardImage = GameAssetImage.boardFrame {
                Image(uiImage: boardImage).resizable()
                    .frame(width: fullW, height: fullH)
                    .offset(x: originX, y: originY)
            }
            placed(redBarRect, scale: frameScale, origin: (originX, originY)) {
                TurnIndicatorView(snapshot: snapshot, isCpuThinking: viewModel.isCpuThinking, playerColors: playerColors)
            }
            placed(gridInset, scale: frameScale, origin: (originX, originY)) {
                grid(snapshot: snapshot, rows: rows, cols: cols, cellSize: cellSize)
            }
            placed(slotRowRect, scale: frameScale, origin: (originX, originY)) {
                SkillTrayView(moves: viewModel.abilityMoves) { move in viewModel.submitAbilityMove(move) }
            }
        }
        .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        .clipped()
        .scaleEffect(scale)
        .offset(offset)
        .gesture(magnifyAndDragGesture)
        .onTapGesture(count: 2) { resetZoom() }
    }

    private func placed(_ rect: CGRect, scale frameScale: CGFloat, origin: (CGFloat, CGFloat), @ViewBuilder content: () -> some View) -> some View {
        content()
            .frame(width: rect.width * frameScale, height: rect.height * frameScale)
            .offset(x: rect.minX * frameScale + origin.0, y: rect.minY * frameScale + origin.1)
    }

    @ViewBuilder
    private func plainBoard(geo: GeometryProxy, snapshot: GameSnapshot, rows: Int, cols: Int) -> some View {
        VStack(spacing: 0) {
            TurnIndicatorView(snapshot: snapshot, isCpuThinking: viewModel.isCpuThinking, playerColors: playerColors)
                .padding(.vertical, 8)
            GeometryReader { innerGeo in
                let cellSize = min(innerGeo.size.width / CGFloat(cols), innerGeo.size.height / CGFloat(rows))
                grid(snapshot: snapshot, rows: rows, cols: cols, cellSize: cellSize)
                    .frame(width: cellSize * CGFloat(cols), height: cellSize * CGFloat(rows))
                    .scaleEffect(scale)
                    .offset(offset)
                    .position(x: innerGeo.size.width / 2, y: cellSize * CGFloat(rows) / 2)
                    .gesture(magnifyAndDragGesture)
                    .onTapGesture(count: 2) { resetZoom() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            SkillTrayView(moves: viewModel.abilityMoves) { move in viewModel.submitAbilityMove(move) }
                .frame(height: 64)
        }
        .frame(width: geo.size.width, height: geo.size.height)
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
