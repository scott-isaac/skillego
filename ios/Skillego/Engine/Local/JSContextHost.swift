import Foundation
import JavaScriptCore

/// Owns one JSContext, loaded with the exact, unmodified engine files the web
/// app ships (constants.js, state.js, rules.js, ai-learning.js, minimax.js,
/// classic-ai.js, gamelog.js, board.js) plus this project's bridge.js glue.
/// The context is touched only from a dedicated serial queue — JSContext isn't
/// thread-safe, and this is the native analog of cpu-worker.js's single-Worker
/// isolation, keeping CPU search off the main thread.
final class JSContextHost {
    /// Bundle resource subdirectory the build-phase script copies the reused
    /// JS files (and bridge.js) into. See ios/scripts/copy-js-engine.sh.
    static let resourceSubdirectory = "JSEngine"

    private static let bundledFiles = [
        "constants", "state", "rules", "ai-learning", "minimax", "classic-ai", "gamelog", "board", "bridge",
    ]

    private let queue = DispatchQueue(label: "com.skillego.jsengine")
    private let context: JSContext
    private let storage: LocalStorageShim

    init(storage: LocalStorageShim = LocalStorageShim(), bundle: Bundle = .main) {
        self.storage = storage
        guard let ctx = JSContext() else {
            fatalError("JavaScriptCore failed to create a JSContext")
        }
        context = ctx
        queue.sync {
            installShims()
            loadEngineFiles(from: bundle)
        }
    }

    private func installShims() {
        let logBlock: @convention(block) (String) -> Void = { message in
            #if DEBUG
            print("[js]", message)
            #endif
        }
        context.setObject(logBlock, forKeyedSubscript: "__nativeLog" as NSString)

        let storage = self.storage
        let getBlock: @convention(block) (String) -> String? = { key in storage.get(key) }
        let setBlock: @convention(block) (String, String) -> Void = { key, value in storage.set(key, value) }
        let removeBlock: @convention(block) (String) -> Void = { key in storage.remove(key) }
        context.setObject(getBlock, forKeyedSubscript: "__lsGet" as NSString)
        context.setObject(setBlock, forKeyedSubscript: "__lsSet" as NSString)
        context.setObject(removeBlock, forKeyedSubscript: "__lsRemove" as NSString)

        context.exceptionHandler = { _, exception in
            #if DEBUG
            print("[js exception]", exception?.toString() ?? "unknown")
            #endif
        }

        context.evaluateScript("""
        var console = {
            log: function () { __nativeLog(Array.prototype.slice.call(arguments).join(' ')); },
            warn: function () { __nativeLog(Array.prototype.slice.call(arguments).join(' ')); },
            error: function () { __nativeLog(Array.prototype.slice.call(arguments).join(' ')); }
        };
        var localStorage = {
            getItem: function (k) { return __lsGet(k); },
            setItem: function (k, v) { __lsSet(k, v); },
            removeItem: function (k) { __lsRemove(k); }
        };
        """, withSourceURL: URL(string: "shims.js")!)
    }

    private func loadEngineFiles(from bundle: Bundle) {
        for name in Self.bundledFiles {
            guard let url = bundle.url(forResource: name, withExtension: "js", subdirectory: Self.resourceSubdirectory)
                    ?? bundle.url(forResource: name, withExtension: "js") else {
                fatalError("Missing bundled engine file: \(name).js (expected in \(Self.resourceSubdirectory)/)")
            }
            guard let source = try? String(contentsOf: url, encoding: .utf8) else {
                fatalError("Failed to read bundled engine file: \(name).js")
            }
            context.evaluateScript(source, withSourceURL: URL(string: "\(name).js")!)
        }
    }

    /// Calls a bridge/engine function by name with plain-string arguments
    /// (JSON-encoded by the caller), returning its JSON-string result. Args and
    /// results round-trip as JSON text — parsed/stringified on the JS side via
    /// bridge.js — rather than relying on Foundation<->JSValue auto-bridging for
    /// the underlying object graphs (board cells, Sets, optional move fields).
    func call(_ function: String, args: [String] = []) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [context] in
                guard let fn = context.objectForKeyedSubscript(function), !fn.isUndefined else {
                    continuation.resume(throwing: GameEngineError.jsException("\(function) is not defined"))
                    return
                }

                var thrown: JSValue?
                let previousHandler = context.exceptionHandler
                context.exceptionHandler = { ctx, exception in
                    thrown = exception
                    previousHandler?(ctx, exception)
                }
                let result = fn.call(withArguments: args)
                context.exceptionHandler = previousHandler

                if let thrown {
                    continuation.resume(throwing: GameEngineError.jsException(thrown.toString() ?? "unknown JS exception"))
                    return
                }
                guard let result, !result.isUndefined, !result.isNull else {
                    continuation.resume(throwing: GameEngineError.invalidResponse("\(function) returned no result"))
                    return
                }
                continuation.resume(returning: result.toString())
            }
        }
    }
}
