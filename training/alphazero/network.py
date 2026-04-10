"""
SkillZero neural network — ResNet with policy + value heads.
TensorFlow / Keras implementation (for TF.js export compatibility).
"""
import os
import numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # suppress TF info spam

import tensorflow as tf
from tensorflow import keras
from .config import (
    NUM_INPUT_CHANNELS, BOARD_ROWS, BOARD_COLS,
    ACTION_SPACE_SIZE, NUM_RES_BLOCKS, NUM_FILTERS,
)


@keras.utils.register_keras_serializable(package='SkillZero')
class ResBlock(keras.layers.Layer):
    """Pre-activation residual block: BN -> ReLU -> Conv -> BN -> ReLU -> Conv + skip."""
    def __init__(self, filters, **kwargs):
        super().__init__(**kwargs)
        self.filters = filters
        self.conv1 = keras.layers.Conv2D(filters, 3, padding='same', use_bias=False)
        self.bn1 = keras.layers.BatchNormalization()
        self.conv2 = keras.layers.Conv2D(filters, 3, padding='same', use_bias=False)
        self.bn2 = keras.layers.BatchNormalization()

    def call(self, x, training=False):
        residual = x
        out = self.conv1(x)
        out = self.bn1(out, training=training)
        out = tf.nn.relu(out)
        out = self.conv2(out)
        out = self.bn2(out, training=training)
        out = out + residual
        out = tf.nn.relu(out)
        return out

    def get_config(self):
        config = super().get_config()
        config['filters'] = self.filters
        return config


def build_network(num_res_blocks=NUM_RES_BLOCKS, filters=NUM_FILTERS):
    """Build a functional-API Keras model.

    Input:  (batch, 6, 6, 24)  — channels-last
    Output: policy logits (batch, 972), value (batch, 1)
    """
    inp = keras.Input(shape=(BOARD_ROWS, BOARD_COLS, NUM_INPUT_CHANNELS), name='board')

    # ── Initial convolution ────────────────────────────────────────────
    x = keras.layers.Conv2D(filters, 3, padding='same', use_bias=False, name='conv_init')(inp)
    x = keras.layers.BatchNormalization(name='bn_init')(x)
    x = keras.layers.ReLU(name='relu_init')(x)

    # ── Residual tower ─────────────────────────────────────────────────
    for i in range(num_res_blocks):
        x = ResBlock(filters, name=f'res_{i}')(x)

    # ── Policy head ────────────────────────────────────────────────────
    p = keras.layers.Conv2D(32, 1, use_bias=False, name='policy_conv')(x)
    p = keras.layers.BatchNormalization(name='policy_bn')(p)
    p = keras.layers.ReLU(name='policy_relu')(p)
    p = keras.layers.Flatten(name='policy_flat')(p)
    p = keras.layers.Dense(ACTION_SPACE_SIZE, name='policy_out')(p)

    # ── Value head ─────────────────────────────────────────────────────
    v = keras.layers.Conv2D(1, 1, use_bias=False, name='value_conv')(x)
    v = keras.layers.BatchNormalization(name='value_bn')(v)
    v = keras.layers.ReLU(name='value_relu')(v)
    v = keras.layers.Flatten(name='value_flat')(v)
    v = keras.layers.Dense(128, activation='relu', name='value_fc')(v)
    v = keras.layers.Dense(1, activation='tanh', name='value_out')(v)

    model = keras.Model(inputs=inp, outputs=[p, v], name='SkillZero')
    return model


class SkillZeroWrapper:
    """Convenient wrapper: handles batching, masking, and saving."""

    def __init__(self, model=None, num_res_blocks=NUM_RES_BLOCKS, filters=NUM_FILTERS):
        if model is not None:
            self.model = model
        else:
            self.model = build_network(num_res_blocks, filters)
        # Build a compiled inference function for speed
        self._infer = tf.function(
            lambda x: self.model(x, training=False),
            input_signature=[tf.TensorSpec(shape=(None, BOARD_ROWS, BOARD_COLS, NUM_INPUT_CHANNELS),
                                           dtype=tf.float32)]
        )
        # Warm up with a dummy forward pass to compile the graph
        dummy = np.zeros((1, BOARD_ROWS, BOARD_COLS, NUM_INPUT_CHANNELS), dtype=np.float32)
        self._infer(tf.constant(dummy))

    def predict(self, state_tensor):
        """Single-state prediction.

        Args:
            state_tensor: (H, W, C) float32 numpy array

        Returns:
            policy_logits: (972,) numpy array of raw logits
            value: scalar float in [-1, 1]
        """
        x = tf.constant(state_tensor[np.newaxis], dtype=tf.float32)
        policy_logits, value = self._infer(x)
        return policy_logits[0].numpy(), value[0, 0].numpy()

    def predict_batch(self, state_tensors):
        """Batch prediction.

        Args:
            state_tensors: (N, H, W, C) float32 numpy array

        Returns:
            policy_logits: (N, 972) numpy array
            values: (N,) numpy array
        """
        x = tf.constant(state_tensors, dtype=tf.float32)
        policy_logits, values = self._infer(x)
        return policy_logits.numpy(), values.numpy().flatten()

    def save(self, path):
        self.model.save(path)

    @classmethod
    def load(cls, path):
        model = keras.models.load_model(path)
        return cls(model=model)

    def copy_weights_to(self, other):
        """Copy this network's weights into another SkillZeroWrapper."""
        other.model.set_weights(self.model.get_weights())

    def get_weights(self):
        return self.model.get_weights()

    def set_weights(self, weights):
        self.model.set_weights(weights)
