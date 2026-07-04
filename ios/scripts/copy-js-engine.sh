#!/bin/bash
# Copies the reused, unmodified web-engine JS files plus this project's bridge.js
# into the app bundle's JSEngine/ resource folder, and the shared art assets into
# GameAssets/. Runs as an Xcode Run Script build phase (see project.yml).
#
# Explicit whitelist, not a folder reference: js/no-modules/ also contains
# DOM-coupled and unused files (board.js's DOM code is fine to load — only its
# pure helpers get called — but game.js, socket-client.js, tournament-client.js,
# replay.js, main.js, cpu.js, cpu-worker.js, mcts.js, nn-mcts.js must never be
# loaded into the DOM-less JSContext, where they'd throw at eval time).
set -euo pipefail

REPO_ROOT="$(cd "${SRCROOT}/.." && pwd)"
JS_SRC="${REPO_ROOT}/js/no-modules"
ASSETS_SRC="${REPO_ROOT}/assets"

JS_DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/JSEngine"
ASSETS_DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GameAssets"

mkdir -p "$JS_DEST" "$ASSETS_DEST/gifs"

REUSED_FILES=(constants.js state.js rules.js ai-learning.js minimax.js classic-ai.js gamelog.js board.js)
for f in "${REUSED_FILES[@]}"; do
    cp "$JS_SRC/$f" "$JS_DEST/$f"
done
cp "${SRCROOT}/Skillego/JSBridge/bridge.js" "$JS_DEST/bridge.js"

cp "$ASSETS_SRC"/*.png "$ASSETS_DEST/"
cp "$ASSETS_SRC"/gifs/*.gif "$ASSETS_DEST/gifs/"

echo "copy-js-engine: bundled ${#REUSED_FILES[@]} engine files + bridge.js, and assets from $ASSETS_SRC"
