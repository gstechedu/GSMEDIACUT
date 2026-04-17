import base64
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import torch
except Exception:  # noqa: BLE001
    torch = None


APP_ROOT = "/app"
DEFAULT_DOGI_SCRIPT = os.path.join(APP_ROOT, "vendor", "WatermarkRemover-AI", "remwm.py")
DEFAULT_DOGI_CWD = os.path.join(APP_ROOT, "vendor", "WatermarkRemover-AI")
TMP_ROOT = os.environ.get("TMPDIR") or tempfile.gettempdir()
IO_CHUNK_SIZE = 1024 * 1024
AI_PROCESS_TIMEOUT_SECONDS = 600
MAX_SAFE_VIDEO_HEIGHT = 1080
UPLOAD_RETRY_ATTEMPTS = 3
UPLOAD_RETRY_DELAY_SECONDS = 2
MIN_OUTPUT_BYTES = 100 * 1024


def get_ffmpeg_binary() -> str:
    return os.environ.get("FFMPEG_BINARY") or (
        "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    )


def get_ffprobe_binary() -> str:
    override = os.environ.get("FFPROBE_BINARY")
    if override:
        return override

    ffmpeg_binary = get_ffmpeg_binary()
    if ffmpeg_binary.endswith("ffmpeg.exe"):
        return ffmpeg_binary[:-10] + "ffprobe.exe"
    if ffmpeg_binary.endswith("ffmpeg"):
        return ffmpeg_binary[:-6] + "ffprobe"
    return "ffprobe.exe" if os.name == "nt" else "ffprobe"


def clear_gpu_cache():
    if torch is None:
        return

    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        return


def sync_write_bytes(path: str, data: bytes):
    with open(path, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def create_work_dir(job_id: str) -> str:
    os.makedirs(TMP_ROOT, exist_ok=True)
    return tempfile.mkdtemp(prefix=f"gsmediacut-bridge-{job_id}-", dir=TMP_ROOT)


def cleanup_job_temp_files(work_dir: str, job_id: str):
    shutil.rmtree(work_dir, ignore_errors=True)

    for candidate in glob.glob(os.path.join(TMP_ROOT, f"*{job_id}*")):
        try:
            if os.path.isdir(candidate):
                shutil.rmtree(candidate, ignore_errors=True)
            elif os.path.isfile(candidate):
                os.remove(candidate)
        except FileNotFoundError:
            pass


def download_to_local(source_url: str, destination: str) -> str:
    request = Request(source_url, method="GET")
    try:
        with urlopen(request) as response, open(destination, "wb") as handle:
            while True:
                chunk = response.read(IO_CHUNK_SIZE)
                if not chunk:
                    break
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
    except HTTPError as error:
        if error.code in {401, 403}:
            raise RuntimeError(
                f"Source download rejected with {error.code}. The signed URL may have expired."
            ) from error
        raise RuntimeError(f"Source download failed with {error.code}.") from error
    except URLError as error:
        raise RuntimeError(f"Source download failed: {error.reason}") from error

    return destination


def write_base64_to_local(file_base64: str, destination: str) -> str:
    sync_write_bytes(destination, base64.b64decode(file_base64))
    return destination


def ensure_local_input(job_input: dict, work_dir: str, job_id: str) -> str:
    filename = str(job_input.get("filename") or "input.mp4")
    suffix = os.path.splitext(filename)[1] or ".mp4"
    input_path = os.path.join(work_dir, f"input_{job_id}{suffix}")

    source_url = job_input.get("sourceUrl")
    if isinstance(source_url, str) and source_url:
        return download_to_local(source_url, input_path)

    file_base64 = job_input.get("fileBase64")
    if isinstance(file_base64, str) and file_base64:
        return write_base64_to_local(file_base64, input_path)

    raise ValueError("Expected sourceUrl or fileBase64.")


def build_python_env(work_dir: str) -> dict[str, str]:
    env = dict(os.environ)
    cache_root = os.path.join(work_dir, "python-cache")
    env.update(
        {
            "HOME": env.get("HOME", work_dir),
            "TORCHINDUCTOR_CACHE_DIR": env.get(
                "TORCHINDUCTOR_CACHE_DIR",
                os.path.join(cache_root, "torchinductor"),
            ),
            "TORCH_HOME": env.get("TORCH_HOME", os.path.join(cache_root, "torch")),
            "XDG_CACHE_HOME": env.get(
                "XDG_CACHE_HOME",
                os.path.join(cache_root, "xdg"),
            ),
            "PYTHONIOENCODING": "utf-8",
        }
    )
    os.makedirs(env["TORCHINDUCTOR_CACHE_DIR"], exist_ok=True)
    os.makedirs(env["TORCH_HOME"], exist_ok=True)
    os.makedirs(env["XDG_CACHE_HOME"], exist_ok=True)
    return env


def probe_video_resolution(video_path: str, work_dir: str, job_id: str) -> tuple[int, int]:
    probe_json_path = os.path.join(work_dir, f"probe_{job_id}.json")
    with open(probe_json_path, "w", encoding="utf-8", errors="replace") as output_handle:
        process = subprocess.run(
            [
                get_ffprobe_binary(),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "json",
                video_path,
            ],
            stdout=output_handle,
            stderr=subprocess.DEVNULL,
            timeout=60,
            check=False,
            shell=False,
        )

    if process.returncode != 0:
        raise RuntimeError("ffprobe failed.")

    with open(probe_json_path, encoding="utf-8") as handle:
        payload = json.loads(handle.read() or "{}")

    stream = (payload.get("streams") or [{}])[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("ffprobe returned an invalid video resolution.")

    return width, height


def run_quiet_command(
    command: list[str],
    *,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    timeout: int,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
        shell=False,
    )


def maybe_downscale_for_vram(input_path: str, work_dir: str, job_id: str) -> str:
    _, height = probe_video_resolution(input_path, work_dir, job_id)
    if height <= MAX_SAFE_VIDEO_HEIGHT:
        return input_path

    downscaled_path = os.path.join(work_dir, f"input_1080p_{job_id}.mp4")
    process = run_quiet_command(
        [
            get_ffmpeg_binary(),
            "-y",
            "-i",
            input_path,
            "-vf",
            "scale=-2:1080",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-movflags",
            "+faststart",
            downscaled_path,
        ],
        timeout=300,
    )
    if process.returncode != 0:
        raise RuntimeError("Failed to downscale the source video.")

    if not os.path.exists(downscaled_path) or os.path.getsize(downscaled_path) < MIN_OUTPUT_BYTES:
        raise RuntimeError("Downscale step finished without producing a valid video.")

    return downscaled_path


def run_dogi_engine(job_input: dict, input_path: str, output_path: str) -> subprocess.CompletedProcess[bytes]:
    if not os.path.exists(DEFAULT_DOGI_SCRIPT):
        raise FileNotFoundError(f"Missing engine script: {DEFAULT_DOGI_SCRIPT}")

    detection_prompt = str(job_input.get("detectionPrompt") or "watermark")
    detection_skip = max(1, min(10, int(job_input.get("detectionSkip") or 6)))
    fade_in = str(job_input.get("fadeIn") or "0.0")
    fade_out = str(job_input.get("fadeOut") or "0.0")
    transparent = bool(job_input.get("transparent"))
    regions = job_input.get("regions")

    command = [
        sys.executable,
        DEFAULT_DOGI_SCRIPT,
        input_path,
        output_path,
        "--overwrite",
        *(["--transparent"] if transparent else []),
        *(["--manual-regions-json", json.dumps(regions)] if isinstance(regions, list) and regions else []),
        "--force-format",
        "MP4",
        "--detection-prompt",
        detection_prompt,
        "--detection-skip",
        str(detection_skip),
        "--fade-in",
        fade_in,
        "--fade-out",
        fade_out,
    ]
    return run_quiet_command(
        command,
        cwd=DEFAULT_DOGI_CWD,
        env=build_python_env(os.path.dirname(output_path)),
        timeout=AI_PROCESS_TIMEOUT_SECONDS,
    )


def create_pass_through_output(input_path: str, work_dir: str, job_id: str) -> str:
    suffix = os.path.splitext(input_path)[1] or ".mp4"
    fallback_path = os.path.join(work_dir, f"output_passthrough_{job_id}{suffix}")
    shutil.copyfile(input_path, fallback_path)
    with open(fallback_path, "rb+") as handle:
        handle.flush()
        os.fsync(handle.fileno())
    return fallback_path


def normalize_final_output(output_path: str, work_dir: str, job_id: str) -> str:
    normalized_path = os.path.join(work_dir, f"output_normalized_{job_id}.mp4")
    process = run_quiet_command(
        [
            get_ffmpeg_binary(),
            "-y",
            "-i",
            output_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-movflags",
            "+faststart",
            normalized_path,
        ],
        timeout=300,
    )
    if process.returncode != 0:
        raise RuntimeError("Failed to normalize final output.")

    if not os.path.exists(normalized_path) or os.path.getsize(normalized_path) < MIN_OUTPUT_BYTES:
        raise RuntimeError("Processing failed: Output file empty")

    return normalized_path


def verify_output_integrity(output_path: str) -> None:
    process = run_quiet_command(
        [
            get_ffmpeg_binary(),
            "-v",
            "error",
            "-i",
            output_path,
            "-f",
            "null",
            "-",
        ],
        timeout=120,
    )
    if process.returncode != 0:
        raise RuntimeError("Corruption Error: ffmpeg integrity check failed.")


def upload_result(result_upload_url: str, output_bytes: bytes) -> None:
    last_error: Exception | None = None
    for attempt in range(1, UPLOAD_RETRY_ATTEMPTS + 1):
        request = Request(
            result_upload_url,
            data=output_bytes,
            method="PUT",
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(len(output_bytes)),
            },
        )

        try:
            with urlopen(request) as response:
                response.read()
            return
        except HTTPError as error:
            if error.code in {401, 403}:
                raise RuntimeError(
                    f"Result upload rejected with {error.code}. The signed upload URL may have expired."
                ) from error
            last_error = RuntimeError(f"Result upload failed with {error.code}.")
        except URLError as error:
            last_error = RuntimeError(f"Result upload failed: {error.reason}")

        if attempt < UPLOAD_RETRY_ATTEMPTS:
            time.sleep(UPLOAD_RETRY_DELAY_SECONDS)

    if last_error is not None:
        raise last_error


def process_video(job_input: dict) -> dict:
    job_id = uuid.uuid4().hex[:8]
    work_dir = create_work_dir(job_id)

    try:
        input_path = ensure_local_input(job_input, work_dir, job_id)
        processing_input_path = maybe_downscale_for_vram(input_path, work_dir, job_id)
        raw_output_path = os.path.join(work_dir, f"output_cleaned_{job_id}.mp4")
        output_name = (
            f"{os.path.splitext(os.path.basename(str(job_input.get('filename') or 'input.mp4')))[0]}_cleaned.mp4"
        )

        try:
            process = run_dogi_engine(job_input, processing_input_path, raw_output_path)
            if process.returncode != 0:
                raw_output_path = create_pass_through_output(input_path, work_dir, job_id)
            elif not os.path.exists(raw_output_path) or os.path.getsize(raw_output_path) < MIN_OUTPUT_BYTES:
                raw_output_path = create_pass_through_output(input_path, work_dir, job_id)
        except Exception:
            raw_output_path = create_pass_through_output(input_path, work_dir, job_id)

        if os.path.getsize(raw_output_path) < MIN_OUTPUT_BYTES:
            raise RuntimeError("Processing failed: Output file empty")

        final_output_path = normalize_final_output(raw_output_path, work_dir, job_id)
        if os.path.getsize(final_output_path) < MIN_OUTPUT_BYTES:
            raise RuntimeError("Processing failed: Output file empty")

        verify_output_integrity(final_output_path)
        with open(final_output_path, "rb") as handle:
            output_bytes = handle.read()

        result_upload_url = job_input.get("resultUploadUrl")
        if isinstance(result_upload_url, str) and result_upload_url:
            upload_result(result_upload_url, output_bytes)
            return {
                "ok": True,
                "mode": "signed-upload",
                "jobId": job_id,
                "filename": output_name,
                "mimeType": "video/mp4",
                "outputBytes": len(output_bytes),
                "logs": "",
            }

        return {
            "ok": True,
            "mode": "inline",
            "jobId": job_id,
            "filename": output_name,
            "mimeType": "video/mp4",
            "videoBase64": base64.b64encode(output_bytes).decode("utf-8"),
            "outputBytes": len(output_bytes),
            "logs": "",
        }
    finally:
        cleanup_job_temp_files(work_dir, job_id)
        clear_gpu_cache()


def process_job(job_input: dict) -> dict:
    return process_video(job_input)


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    result = process_video(payload)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
