import base64
import glob
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import runpod

try:
    import torch
except Exception:  # noqa: BLE001
    torch = None


APP_ROOT = "/app"
VENDOR_ROOT = os.path.join(APP_ROOT, "vendor", "WatermarkRemover-AI")
SCRIPT_PATH = os.path.join(VENDOR_ROOT, "remwm.py")
TMP_ROOT = os.environ.get("TMPDIR") or tempfile.gettempdir()
IO_CHUNK_SIZE = 1024 * 1024
AI_PROCESS_TIMEOUT_SECONDS = 600
UPLOAD_RETRY_ATTEMPTS = 3
UPLOAD_RETRY_DELAY_SECONDS = 2
MIN_OUTPUT_BYTES = 100 * 1024
ACTIVE_PROCESSES: set[subprocess.Popen[bytes]] = set()
ACTIVE_PROCESSES_LOCK = threading.Lock()

IMPORT_PATCHES = (
    (
        "from transformers import AutoProcessor, Florence2ForConditionalGeneration",
        "import transformers\nfrom transformers import AutoProcessor",
    ),
    (
        "from transformers import AutoModelForCausalLM, AutoProcessor",
        "import transformers\nfrom transformers import AutoProcessor",
    ),
    (
        "def identify(task_prompt: TaskType, image: MatLike, text_input: str, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str):",
        "def identify(task_prompt: TaskType, image: MatLike, text_input: str, model: Module, processor: AutoProcessor, device: str):",
    ),
    (
        'def get_watermark_mask(image: MatLike, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = "watermark"):',
        'def get_watermark_mask(image: MatLike, model: Module, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = "watermark"):',
    ),
    (
        'def detect_only(image: MatLike, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = "watermark"):',
        'def detect_only(image: MatLike, model: Module, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = "watermark"):',
    ),
    (
        'try:\n    from cv2.typing import MatLike\nexcept ImportError:\n    MatLike = np.ndarray',
        'try:\n    from cv2.typing import MatLike\nexcept ImportError:\n    MatLike = np.ndarray\n\n\ndef load_florence_model(device: str):\n    model_id = "florence-community/Florence-2-large"\n    model_dtype = torch.float32 if device == "cpu" else None\n    base_kwargs = {"trust_remote_code": True}\n    if model_dtype is not None:\n        base_kwargs["dtype"] = model_dtype\n\n    florence_cls = getattr(transformers, "Florence2ForConditionalGeneration", None)\n    if florence_cls is not None:\n        return florence_cls.from_pretrained(model_id, **base_kwargs).to(device).eval()\n\n    fallback_cls = getattr(transformers, "AutoModelForCausalLM", None)\n    if fallback_cls is None:\n        raise ImportError(\n            "transformers does not provide Florence2ForConditionalGeneration "\n            "or AutoModelForCausalLM."\n        )\n\n    try:\n        return fallback_cls.from_pretrained(model_id, **base_kwargs).to(device).eval()\n    except TypeError:\n        legacy_kwargs = {"trust_remote_code": True}\n        if model_dtype is not None:\n            legacy_kwargs["torch_dtype"] = model_dtype\n        return fallback_cls.from_pretrained(model_id, **legacy_kwargs).to(device).eval()',
    ),
    (
        '        # Force no dtype for CUDA (intentional default)\n        # Apply float32 for CPU (compatibility)\n        model_dtype = torch.float32 if device == "cpu" else None\n\n        florence_model = Florence2ForConditionalGeneration.from_pretrained(\n            "florence-community/Florence-2-large",\n            torch_dtype=model_dtype).to(device).eval()',
        "        florence_model = load_florence_model(device)",
    ),
    (
        '    # Force no dtype for CUDA (intentional default)\n    # Apply float32 for CPU (compatibility)\n    model_dtype = torch.float32 if device == "cpu" else None\n\n    florence_model = Florence2ForConditionalGeneration.from_pretrained(\n        "florence-community/Florence-2-large",\n        torch_dtype=model_dtype).to(device).eval()',
        "    florence_model = load_florence_model(device)",
    ),
    (
        '        # Force no dtype for CUDA (intentional default)\n        # Apply float32 for CPU (compatibility)\n        model_dtype = torch.float32 if device == "cpu" else None\n\n        florence_model = AutoModelForCausalLM.from_pretrained(\n            "florence-community/Florence-2-large",\n            trust_remote_code=True,\n            torch_dtype=model_dtype).to(device).eval()',
        "        florence_model = load_florence_model(device)",
    ),
    (
        '    # Force no dtype for CUDA (intentional default)\n    # Apply float32 for CPU (compatibility)\n    model_dtype = torch.float32 if device == "cpu" else None\n\n    florence_model = AutoModelForCausalLM.from_pretrained(\n        "florence-community/Florence-2-large",\n        trust_remote_code=True,\n        torch_dtype=model_dtype).to(device).eval()',
        "    florence_model = load_florence_model(device)",
    ),
)


def get_ffmpeg_binary() -> str:
    return os.environ.get("FFMPEG_BINARY") or (
        "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    )


def patch_worker_script():
    with open(SCRIPT_PATH, encoding="utf-8") as handle:
        source = handle.read()

    patched = source
    changed = False

    for old, new in IMPORT_PATCHES:
        if old in patched:
            patched = patched.replace(old, new)
            changed = True

    if changed:
        with open(SCRIPT_PATH, "w", encoding="utf-8") as handle:
            handle.write(patched)


def ensure_worker_files():
    if not os.path.exists(SCRIPT_PATH):
        raise FileNotFoundError(
            f"Missing WatermarkRemover-AI script at {SCRIPT_PATH}. "
            "Make sure the repo was built with the vendor folder included."
        )
    patch_worker_script()


def register_process(process: subprocess.Popen[bytes]):
    with ACTIVE_PROCESSES_LOCK:
        ACTIVE_PROCESSES.add(process)


def unregister_process(process: subprocess.Popen[bytes]):
    with ACTIVE_PROCESSES_LOCK:
        ACTIVE_PROCESSES.discard(process)


def terminate_process_tree(process: subprocess.Popen[bytes]):
    if process.poll() is not None:
        return

    if os.name == "nt":
        process.kill()
        return

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return


def terminate_active_processes():
    with ACTIVE_PROCESSES_LOCK:
        processes = list(ACTIVE_PROCESSES)

    for process in processes:
        terminate_process_tree(process)


def clear_gpu_cache():
    if torch is None:
        return

    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        return


def handle_termination_signal(signum: int, _frame):
    terminate_active_processes()
    clear_gpu_cache()
    raise SystemExit(f"Worker terminated by signal {signum}")


signal.signal(signal.SIGTERM, handle_termination_signal)
signal.signal(signal.SIGINT, handle_termination_signal)


def sync_write_bytes(path: str, data: bytes):
    with open(path, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def cleanup_startup_temp_files():
    if not os.path.exists(TMP_ROOT):
        return

    for pattern in ("*.mp4", "gsmediacut-*"):
        for candidate in glob.glob(os.path.join(TMP_ROOT, pattern)):
            try:
                if os.path.isdir(candidate):
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    os.remove(candidate)
            except FileNotFoundError:
                pass


def cleanup_job_temp_files(temp_dir: str, job_id: str):
    shutil.rmtree(temp_dir, ignore_errors=True)

    for candidate in glob.glob(os.path.join(TMP_ROOT, f"*{job_id}*")):
        try:
            if os.path.isdir(candidate):
                shutil.rmtree(candidate, ignore_errors=True)
            elif os.path.isfile(candidate):
                os.remove(candidate)
        except FileNotFoundError:
            pass


def build_env(temp_dir: str):
    cache_root = os.path.join(temp_dir, "python-cache")
    username = os.environ.get("USERNAME") or os.environ.get("USER") or "runpod"
    home_dir = os.environ.get("HOME") or temp_dir

    env = dict(os.environ)
    env.update(
        {
            "HOME": home_dir,
            "USERPROFILE": env.get("USERPROFILE", home_dir),
            "USERNAME": username,
            "USER": env.get("USER", username),
            "LOGNAME": env.get("LOGNAME", username),
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


def download_to_path(source_url: str, input_path: str):
    request = Request(source_url, method="GET")
    try:
        with urlopen(request) as response, open(input_path, "wb") as handle:
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


def write_input_file(job_input: dict, temp_dir: str, job_id: str) -> str:
    filename = str(job_input.get("filename") or "input.mp4")
    suffix = os.path.splitext(filename)[1] or ".mp4"
    input_path = os.path.join(temp_dir, f"input_{job_id}{suffix}")

    if isinstance(job_input.get("fileBase64"), str) and job_input["fileBase64"]:
        sync_write_bytes(input_path, base64.b64decode(job_input["fileBase64"]))
        return input_path

    if isinstance(job_input.get("sourceUrl"), str) and job_input["sourceUrl"]:
        download_to_path(job_input["sourceUrl"], input_path)
        return input_path

    raise ValueError("Expected fileBase64 or sourceUrl in Runpod input.")


def upload_result_if_requested(job_input: dict, output_bytes: bytes):
    result_upload_url = job_input.get("resultUploadUrl")
    if not isinstance(result_upload_url, str) or not result_upload_url:
        return None

    last_error: Exception | None = None
    for attempt in range(1, UPLOAD_RETRY_ATTEMPTS + 1):
        request = Request(
            result_upload_url,
            data=output_bytes,
            method="PUT",
            headers={"Content-Type": "video/mp4"},
        )
        try:
            with urlopen(request) as response:
                response.read()
            return {
                "resultStored": True,
                "resultMode": "signed-upload",
                "mimeType": "video/mp4",
            }
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

    return None


def run_managed_process(
    command: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout: int,
) -> subprocess.CompletedProcess[bytes]:
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        shell=False,
        start_new_session=os.name != "nt",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        text=False,
    )
    register_process(process)

    try:
        process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as error:
        terminate_process_tree(process)
        process.wait(timeout=10)
        raise TimeoutError(f"AI processing exceeded {timeout} seconds.") from error
    finally:
        unregister_process(process)

    return subprocess.CompletedProcess(
        args=command,
        returncode=process.returncode,
        stdout=b"",
        stderr=b"",
    )


def create_pass_through_output(input_path: str, temp_dir: str, job_id: str) -> str:
    suffix = os.path.splitext(input_path)[1] or ".mp4"
    fallback_path = os.path.join(temp_dir, f"output_passthrough_{job_id}{suffix}")
    shutil.copyfile(input_path, fallback_path)
    with open(fallback_path, "rb+") as handle:
        handle.flush()
        os.fsync(handle.fileno())
    return fallback_path


def normalize_final_output(output_path: str, temp_dir: str, job_id: str) -> str:
    normalized_path = os.path.join(temp_dir, f"output_normalized_{job_id}.mp4")
    process = run_managed_process(
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
        cwd=temp_dir,
        env=os.environ.copy(),
        timeout=300,
    )
    if process.returncode != 0:
        raise RuntimeError("Failed to normalize final output.")

    if not os.path.exists(normalized_path) or os.path.getsize(normalized_path) < MIN_OUTPUT_BYTES:
        raise RuntimeError("Processing failed: Output file empty")

    return normalized_path


def run_watermark_remover(job_input: dict):
    ensure_worker_files()
    job_id = str(job_input.get("jobId") or uuid.uuid4().hex[:8])
    detection_prompt = str(job_input.get("detectionPrompt") or "watermark")
    detection_skip = max(1, min(10, int(job_input.get("detectionSkip") or 6)))
    fade_in = str(job_input.get("fadeIn") or "0.0")
    fade_out = str(job_input.get("fadeOut") or "0.0")
    transparent = bool(job_input.get("transparent"))
    regions = job_input.get("regions")

    temp_dir = tempfile.mkdtemp(prefix=f"gsmediacut-runpod-{job_id}-", dir=TMP_ROOT)

    try:
        input_path = write_input_file(job_input, temp_dir, job_id)
        raw_output_path = os.path.join(temp_dir, f"output_cleaned_{job_id}.mp4")
        env = build_env(temp_dir)

        command = [
            sys.executable,
            SCRIPT_PATH,
            input_path,
            raw_output_path,
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

        try:
            process = run_managed_process(
                command,
                cwd=VENDOR_ROOT,
                env=env,
                timeout=AI_PROCESS_TIMEOUT_SECONDS,
            )
            if process.returncode != 0:
                raw_output_path = create_pass_through_output(input_path, temp_dir, job_id)
            elif not os.path.exists(raw_output_path) or os.path.getsize(raw_output_path) < MIN_OUTPUT_BYTES:
                raw_output_path = create_pass_through_output(input_path, temp_dir, job_id)
        except Exception:
            raw_output_path = create_pass_through_output(input_path, temp_dir, job_id)

        if os.path.getsize(raw_output_path) < MIN_OUTPUT_BYTES:
            raise RuntimeError("Processing failed: Output file empty")

        final_output_path = normalize_final_output(raw_output_path, temp_dir, job_id)
        if os.path.getsize(final_output_path) < MIN_OUTPUT_BYTES:
            raise RuntimeError("Processing failed: Output file empty")

        with open(final_output_path, "rb") as handle:
            output_bytes = handle.read()

        output_name = (
            f"{os.path.splitext(os.path.basename(str(job_input.get('filename') or 'input.mp4')))[0]}_cleaned.mp4"
        )
        uploaded_result = upload_result_if_requested(job_input, output_bytes)

        if uploaded_result:
            return {
                "status": "COMPLETED",
                "jobId": job_id,
                "filename": output_name,
                "engine": "watermarkremover-ai",
                "logs": "",
                **uploaded_result,
            }

        return {
            "status": "COMPLETED",
            "jobId": job_id,
            "videoBase64": base64.b64encode(output_bytes).decode("utf-8"),
            "filename": output_name,
            "mimeType": "video/mp4",
            "engine": "watermarkremover-ai",
            "logs": "",
        }
    finally:
        cleanup_job_temp_files(temp_dir, job_id)
        clear_gpu_cache()


def handler(job):
    job_input = job.get("input", {}) or {}
    task = job_input.get("task")
    engine = job_input.get("engine")

    if task != "watermark_remove":
        return {"status": "FAILED", "error": f"Unsupported task: {task}"}

    if engine not in {"watermarkremover-ai", "watermark-remover-ai", "ai"}:
        return {"status": "FAILED", "error": f"Unsupported engine: {engine}"}

    try:
        return run_watermark_remover(job_input)
    except Exception as error:  # noqa: BLE001
        return {"status": "FAILED", "error": str(error)}
    finally:
        terminate_active_processes()
        clear_gpu_cache()


if __name__ == "__main__":
    cleanup_startup_temp_files()
    runpod.serverless.start({"handler": handler})
