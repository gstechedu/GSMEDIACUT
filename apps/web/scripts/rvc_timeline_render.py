from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path


def clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max_value, max(min_value, value))


AUTO_FIT_MAX_SPEED_PERCENT = 135
ROW_RENDER_CACHE_VERSION = 1


def ensure_supported_python() -> None:
    if sys.version_info[:2] not in {(3, 10), (3, 11)}:
        raise RuntimeError(
            "RVC timeline render requires Python 3.10 or 3.11. "
            f"Current version: {sys.version.split()[0]}"
        )


def ensure_tool_root(tool_root: Path) -> None:
    if str(tool_root) not in sys.path:
        sys.path.insert(0, str(tool_root))


def inject_vendored_fairseq(tool_root: Path) -> None:
    candidates = [
        Path(os.getcwd()) / "fairseq",
        Path(os.getcwd()) / "vendor" / "fairseq-0.12.2",
        tool_root / "vendor" / "fairseq-0.12.2",
        tool_root / "fairseq-0.12.2",
        tool_root / "fairseq",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            candidate_str = str(candidate)
            if candidate_str not in sys.path:
                sys.path.insert(0, candidate_str)
                print("DEBUG: Fairseq path injected.")
            return


def prepend_import_paths(*paths: str) -> None:
    valid_paths = [candidate for candidate in paths if candidate and os.path.isdir(candidate)]
    for candidate in reversed(valid_paths):
        if candidate in sys.path:
            sys.path.remove(candidate)
        sys.path.insert(0, candidate)


def load_rvc_inference(tool_root: Path):
    ensure_tool_root(tool_root)
    inject_vendored_fairseq(tool_root)
    from voice_studio.paths import LOCAL_FAIRSEQ_DIR, LOCAL_RVC_PACKAGE_PARENT

    prepend_import_paths(LOCAL_FAIRSEQ_DIR, LOCAL_RVC_PACKAGE_PARENT, str(tool_root))
    module = importlib.import_module("rvc_python.infer")
    return module.RVCInference


def normalize_model_key(value: str) -> str:
    return value.strip().casefold().replace("-", "_")


def resolve_model_reference(model_reference: str, model_search_dirs: list[str]) -> str:
    candidate = (model_reference or "").strip()
    if not candidate:
        return ""
    if os.path.isabs(candidate) and os.path.exists(candidate):
        return candidate
    for model_dir in model_search_dirs:
        possible_path = os.path.join(model_dir, candidate)
        if os.path.exists(possible_path):
            return possible_path
    normalized_candidate = normalize_model_key(Path(candidate).name)
    for model_dir in model_search_dirs:
        if not os.path.isdir(model_dir):
            continue
        for entry in os.scandir(model_dir):
            if not entry.is_file():
                continue
            if normalize_model_key(entry.name) == normalized_candidate:
                return entry.path
    return candidate


def infer_tts_voice(model_hint: str) -> str:
    model_name = Path(model_hint or "").name
    lowered = model_name.strip().lower()
    if "g_300" in lowered or "g300" in lowered:
        print("DEBUG: Using Male Source for Boy AI")
        return "km-KH-PisethNeural"
    if any(
        token in lowered
        for token in (
            "female",
            "girl",
            "woman",
            "srey",
            "sreymom",
            "huihui",
            "zira",
        )
    ):
        return "km-KH-SreymomNeural"
    if any(
        token in lowered
        for token in ("male", "boy", "man", "piseth", "david", "g_300", "g300")
    ):
        return "km-KH-PisethNeural"
    return "km-KH-PisethNeural"


def choose_f0_method(tool_root: Path) -> str:
    rmvpe_path = tool_root / "vendor" / "rvc-python" / "rvc_python" / "base_model" / "rmvpe.pt"
    if rmvpe_path.exists():
        return "rmvpe"
    return "harvest"


def build_rvc_instance(tool_root: Path, model_path: str, preferred_device: str):
    RVCInference = load_rvc_inference(tool_root)
    f0_method = choose_f0_method(tool_root)
    attempts = [preferred_device]
    if preferred_device != "cpu":
        attempts.append("cpu")

    last_error: Exception | None = None
    for device in attempts:
        try:
            rvc = RVCInference(device=device)
            rvc.load_model(model_path, version="v2")
            rvc.set_params(
                f0up_key=0,
                f0method=f0_method,
                index_rate=0.75,
                filter_radius=3,
                resample_sr=0,
                rms_mix_rate=0.25,
                protect=0.33,
            )
            return rvc
        except Exception as exc:  # noqa: BLE001
            last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError("Could not initialize RVC inference.")


def apply_audio_postprocess(clip, *, pitch_semitones: float, echo_percent: float, volume_db: float):
    processed = clip

    if pitch_semitones:
        original_frame_rate = processed.frame_rate
        shifted_frame_rate = int(round(original_frame_rate * (2 ** (pitch_semitones / 12.0))))
        processed = processed._spawn(processed.raw_data, overrides={"frame_rate": shifted_frame_rate})
        processed = processed.set_frame_rate(original_frame_rate)

    if echo_percent > 0:
        decay = clamp(echo_percent / 100.0, 0.05, 0.65)
        attenuation_db = max(1.5, 18.0 * (1.0 - decay))
        delayed = processed.apply_gain(-attenuation_db)
        processed = processed.overlay(delayed, position=120)

    if volume_db:
        processed = processed.apply_gain(volume_db)

    return processed


def get_row_cache_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "GSMEDIACUT" / "transition-row-cache"
    return Path(tempfile.gettempdir()) / "gsmediacut-transition-row-cache"


def get_file_signature(file_path: str) -> dict[str, int | str]:
    stats = os.stat(file_path)
    return {
        "path": str(Path(file_path).resolve()),
        "size": int(stats.st_size),
        "mtimeNs": int(stats.st_mtime_ns),
    }


def build_row_cache_key(
    *,
    row: dict,
    acting_engine: str,
    model_path: str,
) -> str:
    cache_payload = {
        "version": ROW_RENDER_CACHE_VERSION,
        "actingEngine": acting_engine,
        "model": get_file_signature(model_path),
        "targetDurationSeconds": max(
            0.15,
            float(row.get("endSeconds") or 0.0) - float(row.get("startSeconds") or 0.0),
        ),
        "text": str(row.get("text", "")).strip(),
        "voiceModel": str(row.get("voiceModel", "")).strip(),
        "speedPercent": int(row.get("speedPercent") or 100),
        "pitchSemitones": float(row.get("pitchSemitones") or 0),
        "echoPercent": float(row.get("echoPercent") or 0),
        "volumeDb": float(row.get("volumeDb") or 0),
        "style": str(row.get("style") or "Adult"),
        "emotion": str(row.get("emotion") or "natural"),
    }
    serialized = json.dumps(cache_payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def load_cached_row_render(*, AudioSegment, cache_key: str):
    cache_root = get_row_cache_root()
    metadata_path = cache_root / f"{cache_key}.json"
    audio_path = cache_root / f"{cache_key}.wav"

    if not metadata_path.exists() or not audio_path.exists():
        return None

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        cached_audio = AudioSegment.from_file(str(audio_path))
        return {
            "audio": cached_audio,
            "durationSeconds": float(metadata["durationSeconds"]),
            "speedPercent": int(metadata["speedPercent"]),
            "voiceModel": str(metadata["voiceModel"]),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"DEBUG: Row cache read failed: {exc}")
        return None


def save_cached_row_render(*, cache_key: str, audio, duration_seconds: float, speed_percent: int, voice_model: str):
    cache_root = get_row_cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    metadata_path = cache_root / f"{cache_key}.json"
    audio_path = cache_root / f"{cache_key}.wav"

    audio.export(str(audio_path), format="wav")
    metadata_path.write_text(
        json.dumps(
            {
                "durationSeconds": duration_seconds,
                "speedPercent": speed_percent,
                "voiceModel": voice_model,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def render_clip_for_row(
    *,
    row: dict,
    row_index: int,
    work_dir: Path,
    generate_acting_clip,
    AudioSegment,
    rvc_cache: dict[str, object],
    tool_root: Path,
    model_search_dirs: list[str],
    preferred_device: str,
    acting_engine: str,
):
    text = str(row.get("text", "")).strip()
    if not text:
        return None

    model_reference = str(row.get("voiceModel", "")).strip()
    model_path = resolve_model_reference(model_reference, model_search_dirs)
    if not model_path or not os.path.exists(model_path):
        raise FileNotFoundError(f"RVC model not found: {model_reference}")
    model_name = Path(model_path).name
    cache_key = build_row_cache_key(
        row=row,
        acting_engine=acting_engine,
        model_path=model_path,
    )
    cached_row = load_cached_row_render(AudioSegment=AudioSegment, cache_key=cache_key)
    if cached_row is not None:
        print(f"DEBUG: Row cache hit for {model_name}")
        return cached_row

    rvc = rvc_cache.get(model_path)
    if rvc is None:
        rvc = build_rvc_instance(tool_root, model_path, preferred_device)
        rvc_cache[model_path] = rvc

    requested_speed_percent = int(row.get("speedPercent") or 100)
    requested_speed_percent = int(clamp(requested_speed_percent, 0, 300))
    max_auto_speed_percent = max(requested_speed_percent, AUTO_FIT_MAX_SPEED_PERCENT)
    target_duration_seconds = max(
        0.15,
        float(row.get("endSeconds") or 0.0) - float(row.get("startSeconds") or 0.0),
    )
    effective_speed_percent = requested_speed_percent
    best_audio = None
    best_duration_seconds = 0.0

    for attempt in range(3):
        suffix = f"{row_index:04d}-{attempt}"
        acting_path = work_dir / f"{suffix}_acting.wav"
        converted_path = work_dir / f"{suffix}_converted.wav"
        final_path = work_dir / f"{suffix}_final.wav"

        generate_acting_clip(
            engine=acting_engine,
            text=text,
            output_path=acting_path,
            tts_voice=infer_tts_voice(model_name),
            speed_percent=str(effective_speed_percent - 100),
            age_profile=str(row.get("style") or "Adult"),
            model_reference=model_name,
            emotion=str(row.get("emotion") or "natural"),
        )
        # --- DEBUG LOGS FOR MENGHEANG ---
        print(f"DEBUG: Model Path requested: {model_path}")
        print(f"DEBUG: Model exists on disk: {os.path.exists(model_path)}")
        print(f"DEBUG: Acting WAV (Source): {acting_path} | Size: {os.path.getsize(acting_path)}")
        print(f"DEBUG: Starting RVC for {model_name}...")

        final_audio_path = acting_path
        try:
            rvc.infer_file(str(acting_path), str(converted_path))
            if os.path.exists(converted_path) and os.path.getsize(converted_path) > 1000:
                print("DEBUG: RVC SUCCESS! Using converted file.")
                print(f"DEBUG: SUCCESS! RVC created: {converted_path}")
                final_audio_path = converted_path
            else:
                print("DEBUG: RVC FAILED (Empty File). Falling back to TTS.")
                print("DEBUG: FAILED! RVC ran but output file is empty or missing.")
        except Exception as e:
            print(f"DEBUG: RVC CRASH Error: {str(e)}")
            print(f"DEBUG: CRASH during RVC inference: {str(e)}")
        # --------------------------------

        converted_clip = AudioSegment.from_file(str(final_audio_path))
        final_clip = apply_audio_postprocess(
            converted_clip,
            pitch_semitones=float(row.get("pitchSemitones") or 0),
            echo_percent=float(row.get("echoPercent") or 0),
            volume_db=float(row.get("volumeDb") or 0),
        ).set_channels(1)
        final_clip.export(str(final_path), format="wav")

        best_audio = final_clip
        best_duration_seconds = len(final_clip) / 1000.0
        if best_duration_seconds <= target_duration_seconds + 0.01:
            break

        next_speed = int(round(effective_speed_percent * (best_duration_seconds / target_duration_seconds)))
        next_speed = int(
            clamp(next_speed, effective_speed_percent, max_auto_speed_percent)
        )
        if next_speed <= effective_speed_percent:
            break
        effective_speed_percent = next_speed

    if best_audio is None:
        raise RuntimeError(f"Could not render row {row_index + 1}.")

    save_cached_row_render(
        cache_key=cache_key,
        audio=best_audio,
        duration_seconds=best_duration_seconds,
        speed_percent=effective_speed_percent,
        voice_model=Path(model_path).name,
    )

    return {
        "audio": best_audio,
        "durationSeconds": best_duration_seconds,
        "speedPercent": effective_speed_percent,
        "voiceModel": Path(model_path).name,
    }


def build_track(
    *,
    tool_root: Path,
    rows: list[dict],
    work_dir: Path,
    output_path: Path,
    preferred_device: str,
    acting_engine: str,
):
    ensure_tool_root(tool_root)
    from pydub import AudioSegment
    from voice_studio.acting_engines import (
        generate_acting_clip,
        normalize_acting_engine_name,
    )
    from voice_studio.paths import FFMPEG_EXE, FFPROBE_EXE, MODEL_SEARCH_DIRS

    AudioSegment.converter = str(FFMPEG_EXE)
    AudioSegment.ffprobe = str(FFPROBE_EXE)
    normalized_acting_engine = normalize_acting_engine_name(acting_engine)

    adjusted_rows: list[dict] = []
    rendered_segments: list[tuple[int, object]] = []
    rvc_cache: dict[str, object] = {}
    timeline_cursor_seconds = 0.0

    for row_index, row in enumerate(rows):
        rendered = render_clip_for_row(
            row=row,
            row_index=row_index,
            work_dir=work_dir,
            generate_acting_clip=generate_acting_clip,
            AudioSegment=AudioSegment,
            rvc_cache=rvc_cache,
            tool_root=tool_root,
            model_search_dirs=list(MODEL_SEARCH_DIRS),
            preferred_device=preferred_device,
            acting_engine=normalized_acting_engine,
        )
        if rendered is None:
            continue

        requested_start_seconds = max(0.0, float(row.get("startSeconds") or 0.0))
        actual_start_seconds = max(requested_start_seconds, timeline_cursor_seconds)
        actual_end_seconds = actual_start_seconds + rendered["durationSeconds"]
        timeline_cursor_seconds = actual_end_seconds

        rendered_segments.append((int(round(actual_start_seconds * 1000)), rendered["audio"]))
        adjusted_rows.append(
            {
                **row,
                "startSeconds": actual_start_seconds,
                "endSeconds": actual_end_seconds,
                "speedPercent": rendered["speedPercent"],
                "voiceModel": rendered["voiceModel"],
            }
        )

    if not rendered_segments:
        raise RuntimeError("No subtitle rows with text were available for audio export.")

    total_duration_ms = max(position_ms + len(segment) for position_ms, segment in rendered_segments) + 1000
    final_mix = AudioSegment.silent(duration=total_duration_ms)
    for position_ms, segment in rendered_segments:
        final_mix = final_mix.overlay(segment, position=position_ms)
    final_mix.export(str(output_path), format="wav")

    return adjusted_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render timeline voice audio with local RVC models.")
    parser.add_argument("--tool-root", required=True, help="Path to TOOL BUILD OWN API root.")
    parser.add_argument("--input-json", required=True, help="Path to input JSON payload.")
    parser.add_argument("--output-json", required=True, help="Path to output JSON payload.")
    parser.add_argument("--device", default="cuda:0", help="Preferred RVC device.")
    return parser.parse_args()


def main() -> int:
    ensure_supported_python()
    args = parse_args()
    tool_root = Path(args.tool_root).expanduser().resolve()
    input_json_path = Path(args.input_json).expanduser().resolve()
    output_json_path = Path(args.output_json).expanduser().resolve()

    if not tool_root.exists():
        raise FileNotFoundError(f"TOOL BUILD OWN API root not found: {tool_root}")
    if not input_json_path.exists():
        raise FileNotFoundError(f"Input payload not found: {input_json_path}")

    payload = json.loads(input_json_path.read_text(encoding="utf-8-sig"))
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise ValueError("Input payload is missing rows.")
    acting_engine = str(payload.get("actingEngine") or "StyleTTS2")

    work_dir = output_json_path.parent / "rvc-work"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_audio_path = output_json_path.parent / "timeline-voice-track.wav"
    adjusted_rows = build_track(
        tool_root=tool_root,
        rows=rows,
        work_dir=work_dir,
        output_path=output_audio_path,
        preferred_device=args.device,
        acting_engine=acting_engine,
    )

    output_json_path.write_text(
        json.dumps(
            {
                "outputPath": str(output_audio_path),
                "rows": adjusted_rows,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
