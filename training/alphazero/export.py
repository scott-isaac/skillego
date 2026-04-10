"""
Export trained Keras model to TensorFlow.js format for browser use.

Usage:
    cd C:\\EpicSource\\web\\skillego\\training
    .venv\\Scripts\\python.exe -m alphazero.export [--model PATH] [--out DIR]

This converts champion.keras -> a tfjs model directory that the browser
game's mcts.js can load via tf.loadLayersModel().

Uses the CLI converter (tensorflowjs_converter) via subprocess to avoid
numpy version conflicts with the tensorflowjs Python API.
"""
import os
import sys
import argparse
import subprocess
import shutil
import tempfile


def export_to_tfjs(keras_path, output_dir):
    """Convert a .keras model to TensorFlow.js graph model format."""
    import numpy as np
    # Monkey-patch numpy for tensorflowjs compatibility (removed aliases)
    if not hasattr(np, 'object'):
        np.object = object
    if not hasattr(np, 'bool'):
        np.bool = bool

    import tensorflow as tf
    from alphazero.network import SkillZeroWrapper

    print(f"Loading model from {keras_path}...")
    wrapper = SkillZeroWrapper.load(keras_path)
    model = wrapper.model

    print(f"Model: {model.count_params():,} parameters")
    print(f"Input:  {model.input_shape}")
    print(f"Output: {[o.shape for o in model.output]}")

    # Save as SavedModel format, then convert with tensorflowjs
    with tempfile.TemporaryDirectory() as tmpdir:
        saved_model_dir = os.path.join(tmpdir, 'saved_model')
        print("Saving as TF SavedModel...")
        model.export(saved_model_dir)

        os.makedirs(output_dir, exist_ok=True)
        print("Converting to TF.js...")

        try:
            import tensorflowjs as tfjs
            # Try direct Keras model save (handles standard layers best)
            tfjs.converters.save_keras_model(model, output_dir)
        except Exception as e:
            print(f"tensorflowjs save_keras_model failed: {e}")
            try:
                # Try SavedModel conversion
                tfjs.converters.convert_tf_saved_model(saved_model_dir, output_dir)
            except Exception as e2:
                print(f"SavedModel conversion also failed: {e2}")
                print("Falling back to manual weight export...")
                _try_direct_keras_export(model, output_dir)

    # Write trained-model marker (nn-mcts.js checks for this before loading)
    import json, datetime
    marker = {
        'trained': True,
        'exported_at': datetime.datetime.now().isoformat(),
        'source': os.path.basename(keras_path),
        'params': model.count_params(),
    }
    # Try to read iteration from training log
    log_path = os.path.join(os.path.dirname(keras_path), 'training_log.jsonl')
    if os.path.exists(log_path):
        with open(log_path) as f:
            lines = f.readlines()
            if lines:
                last = json.loads(lines[-1])
                marker['iteration'] = last.get('iteration', 0)
    with open(os.path.join(output_dir, 'trained.json'), 'w') as f:
        json.dump(marker, f, indent=2)

    # List exported files
    if os.path.exists(output_dir):
        files = os.listdir(output_dir)
        total_size = sum(os.path.getsize(os.path.join(output_dir, f)) for f in files)
        print(f"\nExported {len(files)} files ({total_size / 1024:.0f} KB):")
        for f in sorted(files):
            size = os.path.getsize(os.path.join(output_dir, f))
            print(f"  {f} ({size / 1024:.0f} KB)")


def _try_direct_keras_export(model, output_dir):
    """Fallback: save model weights as raw JSON + binary for manual JS loading."""
    import json
    import numpy as np

    print("Using manual weight export (JSON + binary)...")
    os.makedirs(output_dir, exist_ok=True)

    weights = model.get_weights()
    weight_specs = []
    all_bytes = b''

    for i, (w, layer_w) in enumerate(zip(weights, model.weights)):
        name = layer_w.path  # full path like "conv_init/kernel"
        arr = w.astype(np.float32)
        weight_bytes = arr.tobytes()
        weight_specs.append({
            'name': name,
            'shape': list(arr.shape),
            'dtype': 'float32',
            'byteOffset': len(all_bytes),
            'byteLength': len(weight_bytes),
        })
        all_bytes += weight_bytes

    # Save weights binary
    weights_path = os.path.join(output_dir, 'weights.bin')
    with open(weights_path, 'wb') as f:
        f.write(all_bytes)

    # Save model topology + weight manifest
    config = model.get_config()
    manifest = {
        'modelTopology': config,
        'weightsManifest': [{
            'paths': ['weights.bin'],
            'weights': weight_specs,
        }],
        'format': 'layers-model',
        'generatedBy': 'skillzero-export',
    }

    model_json_path = os.path.join(output_dir, 'model.json')
    with open(model_json_path, 'w') as f:
        json.dump(manifest, f)

    print(f"Saved {len(weights)} weight arrays ({len(all_bytes) / 1024:.0f} KB)")


def main():
    parser = argparse.ArgumentParser(description='Export SkillZero model to TF.js')
    parser.add_argument('--model', type=str, default=None,
                        help='Path to .keras model (default: models/champion.keras)')
    parser.add_argument('--out', type=str, default=None,
                        help='Output directory (default: ../../js/no-modules/model/)')
    args = parser.parse_args()

    training_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    game_dir = os.path.dirname(training_dir)  # skillego/

    # Default model path
    model_path = args.model or os.path.join(training_dir, 'models', 'champion.keras')
    if not os.path.exists(model_path):
        print(f"ERROR: Model not found at {model_path}")
        print("Train first: python -m alphazero.train")
        sys.exit(1)

    # Default output: alongside the game's JS files
    output_dir = args.out or os.path.join(game_dir, 'js', 'no-modules', 'model')

    export_to_tfjs(model_path, output_dir)

    print(f"\nModel ready for browser. Load in JS with:")
    print(f'  const model = await tf.loadLayersModel("model/model.json");')


if __name__ == '__main__':
    main()
