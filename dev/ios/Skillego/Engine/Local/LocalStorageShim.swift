import Foundation

/// Backing store for the JS engine's `localStorage` shim (used by ai-learning.js).
/// A JSON file on disk rather than UserDefaults — a closer semantic match for an
/// arbitrary string-keyed/string-valued store the JS code manages the read/write
/// timing for, and keeps it out of the app's UserDefaults domain.
final class LocalStorageShim {
    private let fileURL: URL
    private var store: [String: String]
    private let lock = NSLock()

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Skillego", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("local-storage.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String: String].self, from: data) {
            store = decoded
        } else {
            store = [:]
        }
    }

    func get(_ key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return store[key]
    }

    func set(_ key: String, _ value: String) {
        lock.lock()
        store[key] = value
        let snapshot = store
        lock.unlock()
        persist(snapshot)
    }

    func remove(_ key: String) {
        lock.lock()
        store.removeValue(forKey: key)
        let snapshot = store
        lock.unlock()
        persist(snapshot)
    }

    private func persist(_ snapshot: [String: String]) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
