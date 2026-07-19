#!/usr/bin/env python3
"""Generate a seamless documentary music bed without beats or pulse modulation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile


SAMPLE_RATE = 48_000
LOOP_SECONDS = 64.0
CHORDS = (
    (55.00, 110.00, 146.83, 164.81, 220.00),
    (43.65, 87.31, 130.81, 164.81, 220.00),
    (65.41, 130.81, 164.81, 196.00, 246.94),
    (49.00, 98.00, 146.83, 196.00, 220.00),
)


def quantize_loop_frequency(value: float) -> float:
    return round(value * LOOP_SECONDS) / LOOP_SECONDS


def smoothstep(value: np.ndarray) -> np.ndarray:
    return value * value * (3.0 - 2.0 * value)


def chord_signal(t: np.ndarray, frequencies: tuple[float, ...], side: str) -> np.ndarray:
    signal = np.zeros_like(t, dtype=np.float32)
    pan_phase = 0.13 if side == "right" else 0.0
    for index, frequency in enumerate(frequencies):
        base = quantize_loop_frequency(frequency)
        phase = index * 0.71 + pan_phase
        amplitude = 0.25 / (1.0 + index * 0.34)
        signal += amplitude * np.sin(2.0 * np.pi * base * t + phase)
        signal += amplitude * 0.10 * np.sin(2.0 * np.pi * base * 2.0 * t + phase * 1.7)
    rms = float(np.sqrt(np.mean(signal * signal)))
    return signal / max(rms, 1e-9)


def build_loop() -> np.ndarray:
    sample_count = int(SAMPLE_RATE * LOOP_SECONDS)
    t = np.arange(sample_count, dtype=np.float64) / SAMPLE_RATE
    segment_seconds = LOOP_SECONDS / len(CHORDS)
    segment_index = np.floor(t / segment_seconds).astype(np.int32)
    local = (t % segment_seconds) / segment_seconds
    blend = smoothstep(local.astype(np.float32))

    channels = []
    for side in ("left", "right"):
        chord_layers = [chord_signal(t, chord, side) for chord in CHORDS]
        channel = np.zeros(sample_count, dtype=np.float32)
        for index in range(len(CHORDS)):
            mask = segment_index == index
            next_index = (index + 1) % len(CHORDS)
            channel[mask] = (
                chord_layers[index][mask] * (1.0 - blend[mask])
                + chord_layers[next_index][mask] * blend[mask]
            )
        channels.append(channel)

    stereo = np.column_stack(channels)
    stereo -= np.mean(stereo, axis=0, keepdims=True)
    peak = float(np.max(np.abs(stereo)))
    stereo *= (10.0 ** (-10.0 / 20.0)) / max(peak, 1e-9)
    return stereo


def pulse_metric(stereo: np.ndarray) -> float:
    mono = np.mean(stereo, axis=1)
    frame = SAMPLE_RATE // 2
    usable = len(mono) // frame * frame
    rms = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1) + 1e-12)
    db = 20.0 * np.log10(rms)
    slow_window = 9
    kernel = np.ones(slow_window, dtype=np.float32) / slow_window
    slow = np.convolve(db, kernel, mode="same")
    margin = slow_window
    fast = db[margin:-margin] - slow[margin:-margin]
    return float(np.percentile(np.abs(fast), 95))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--meta", type=Path)
    args = parser.parse_args()

    stereo = build_loop()
    metric = pulse_metric(stereo)
    if metric > 0.35:
        raise SystemExit(f"fast RMS modulation too high: {metric:.3f} dB")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)
    wavfile.write(args.output, SAMPLE_RATE, pcm)

    metadata = {
        "kind": "sustained_documentary_bed",
        "duration": LOOP_SECONDS,
        "sampleRate": SAMPLE_RATE,
        "seamlessLoop": True,
        "percussion": False,
        "tremolo": False,
        "gating": False,
        "sidechainPumping": False,
        "fastRmsModulationP95Db": round(metric, 4),
    }
    meta_path = args.meta or args.output.with_suffix(".json")
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(args.output), **metadata}, ensure_ascii=False))


if __name__ == "__main__":
    main()
