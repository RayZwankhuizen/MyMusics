#!/usr/bin/env python3
import json
import os
import signal
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

try:
    import numpy as np
except Exception as error:
    print(json.dumps({"error": f"Host audio analysis needs NumPy: {error}"}), flush=True)
    raise SystemExit(0)

SAMPLE_RATE = 16_000
WINDOW = 15_600
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite"
running = True
ffmpeg = None


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def shutdown(_signum, _frame):
    global running
    running = False
    if ffmpeg and ffmpeg.poll() is None:
        ffmpeg.terminate()


def model_path():
    directory = Path(os.environ.get("MYMUSICS_DATA_DIR", tempfile.gettempdir())) / "audio-analysis"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "yamnet.tflite"
    if target.is_file() and target.stat().st_size > 1_000_000:
        return target
    temporary = target.with_suffix(".download")
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=30) as response, temporary.open("wb") as output:
            length = int(response.headers.get("Content-Length", "0"))
            if length and not 1_000_000 < length < 50_000_000:
                raise ValueError("Unexpected YAMNet model size.")
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 50_000_000:
                    raise ValueError("YAMNet model is too large.")
                output.write(chunk)
        if total <= 1_000_000:
            raise ValueError("YAMNet model download was incomplete.")
        temporary.replace(target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def create_classifier():
    try:
        import mediapipe as mp
        path = model_path()
        options = mp.tasks.audio.AudioClassifierOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(path)),
            category_allowlist=["Speech", "Singing", "Music"],
            score_threshold=0,
            max_results=521,
        )
        return mp.tasks.audio.AudioClassifier.create_from_options(options)
    except Exception as error:
        emit({"warning": f"Classifier unavailable: {error}"})
        return None


def spectrum(samples):
    magnitudes = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    bins = np.array_split(magnitudes[:8001], 64)
    peak = max((float(chunk.max()) for chunk in bins if len(chunk)), default=1.0)
    return [int(np.clip(255 * np.log1p(chunk.mean()) / np.log1p(peak), 0, 255)) if len(chunk) else 0 for chunk in bins]


def waveform(samples):
    edges = np.linspace(0, len(samples), 181, dtype=np.int32)
    return [round(float(samples[min(edge, len(samples) - 1)]), 4) for edge in edges[:-1]]


def main():
    global ffmpeg
    if len(sys.argv) != 3:
        raise ValueError("Expected the shared radio stream URL and classifier mode.")
    stream_url, classify = sys.argv[1], sys.argv[2] == "classify"
    classifier = create_classifier() if classify else None
    ffmpeg = subprocess.Popen([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", stream_url,
        "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    emit({"ready": True, "classifier": classifier is not None})
    size = WINDOW * 4
    while running:
        raw = bytearray()
        while running and len(raw) < size:
            chunk = ffmpeg.stdout.read(size - len(raw))
            if not chunk:
                if ffmpeg.poll() is not None:
                    return
                continue
            raw.extend(chunk)
        if not running or len(raw) != size:
            return
        samples = np.frombuffer(raw, dtype="<f4").copy()
        scores = None
        if classifier:
            audio = __import__("mediapipe").tasks.components.containers.AudioData.create_from_array(samples, SAMPLE_RATE)
            results = classifier.classify(audio)
            values = {"Speech": 0.0, "Singing": 0.0, "Music": 0.0}
            for result in results:
                for category in result.classifications[0].categories:
                    if category.category_name in values:
                        values[category.category_name] = max(values[category.category_name], category.score)
            scores = [values[key] for key in ("Speech", "Singing", "Music")]
        emit({"scores": scores, "waveform": waveform(samples), "spectrum": spectrum(samples)})


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)
try:
    main()
except Exception as error:
    emit({"error": str(error)})
finally:
    if ffmpeg and ffmpeg.poll() is None:
        ffmpeg.terminate()
