import ImageIO
import SwiftUI
import UIKit

private struct GIFFrame {
    let image: UIImage
    let duration: Double
}

/// Decodes gifs bundled under GameAssets/gifs (see copy-js-engine.sh) via
/// ImageIO — ships with iOS, so no third-party GIF library is needed for the
/// handful of small looping effects this game uses.
private enum GIFLoader {
    private static var cache: [String: [GIFFrame]] = [:]

    static func frames(named name: String) -> [GIFFrame] {
        if let cached = cache[name] { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "gif", subdirectory: "GameAssets/gifs"),
              let data = try? Data(contentsOf: url),
              let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            return []
        }
        let count = CGImageSourceGetCount(source)
        var frames: [GIFFrame] = []
        frames.reserveCapacity(count)
        for index in 0..<count {
            guard let cgImage = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
            frames.append(GIFFrame(image: UIImage(cgImage: cgImage), duration: frameDuration(source: source, index: index)))
        }
        cache[name] = frames
        return frames
    }

    private static func frameDuration(source: CGImageSource, index: Int) -> Double {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
              let gifProperties = properties[kCGImagePropertyGIFDictionary] as? [CFString: Any] else {
            return 0.1
        }
        let unclamped = gifProperties[kCGImagePropertyGIFUnclampedDelayTime] as? Double
        let clamped = gifProperties[kCGImagePropertyGIFDelayTime] as? Double
        return unclamped ?? clamped ?? 0.1
    }
}

/// Loops a bundled gif by name (no extension). `name` changing (e.g. a
/// different player's fire color) reloads and restarts the animation.
struct AnimatedGIFView: View {
    let name: String

    @State private var frames: [GIFFrame] = []
    @State private var currentIndex = 0
    @State private var timer: Timer?

    var body: some View {
        Group {
            if let image = frames[safe: currentIndex]?.image {
                Image(uiImage: image).resizable()
            } else {
                Color.clear
            }
        }
        .onAppear { load() }
        .onDisappear { timer?.invalidate() }
        .onChange(of: name) { _, _ in load() }
    }

    private func load() {
        timer?.invalidate()
        currentIndex = 0
        frames = GIFLoader.frames(named: name)
        scheduleNextFrame()
    }

    private func scheduleNextFrame() {
        guard frames.count > 1 else { return }
        let duration = frames[currentIndex].duration
        let next = Timer(timeInterval: duration, repeats: false) { _ in
            currentIndex = (currentIndex + 1) % frames.count
            scheduleNextFrame()
        }
        // .common (not just Timer.scheduledTimer's default .default mode) so
        // frame advancement keeps going during scroll/gesture tracking and
        // heavy view-update passes, rather than stalling until things settle.
        RunLoop.current.add(next, forMode: .common)
        timer = next
    }
}
