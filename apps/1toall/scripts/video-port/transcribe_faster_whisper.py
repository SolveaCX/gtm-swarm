#!/usr/bin/env python3
"""Word-level transcription via local faster-whisper — mlx_whisper drop-in for Linux.

Replaces mlx_whisper (Apple-silicon-only) in the caption alignment step.
Free, no API key, CPU-capable. Output matches the mlx_words.json structure the
existing align_captions_mlx.py consumes:

    {"text": "...", "segments": [{"start": s, "end": e, "text": "...",
                                  "words": [{"word": w, "start": s, "end": e}, ...]}]}

Server setup (once):  pip install faster-whisper   (first run downloads the model)

Usage:
    python3 transcribe_faster_whisper.py --audio voice.mp3 --out words.json \
        [--model small] [--lang zh] [--device cpu] [--compute-type int8]
"""
import argparse
import json
import sys


def transcribe(audio: str, out_path: str, model_name: str, lang: str | None,
               device: str, compute_type: str) -> None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper not installed — run: pip install faster-whisper")

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    seg_iter, info = model.transcribe(audio, language=lang, word_timestamps=True)

    segments, full_text = [], []
    for seg in seg_iter:
        words = [{"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                 for w in (seg.words or [])]
        segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text,
            "words": words,
        })
        full_text.append(seg.text)

    doc = {"text": "".join(full_text).strip(), "language": info.language,
           "segments": segments}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    n_words = sum(len(s["words"]) for s in segments)
    print(f"ok {out_path} segments={len(segments)} words={n_words} lang={info.language}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="small", help="tiny/base/small/medium/large-v3")
    p.add_argument("--lang", default=None, help="e.g. zh / en; omit = auto-detect")
    p.add_argument("--device", default="cpu")
    p.add_argument("--compute-type", default="int8")
    a = p.parse_args()
    transcribe(a.audio, a.out, a.model, a.lang, a.device, a.compute_type)


if __name__ == "__main__":
    main()
