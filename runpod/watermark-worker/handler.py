import base64
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import runpod


APP_ROOT = Path("/app")
WORKER_ROOT = APP_ROOT / "runpod" / "watermark-worker"
VENDOR_ROOT = APP_ROOT / "vendor" / "WatermarkRemover-AI"
SCRIPT_PATH = VENDOR_ROOT / "remwm.py"


def ensure_worker_files():
    if not SCRIPT_PATH.exists():
        raise FileNotFoundError(
            f"Missing WatermarkRemover-AI script at {SCRIPT_PATH}. "
            "Make sure the repo was built with the vendor folder included."
        )


def build_env(temp_dir: Path):
    cache_root = temp_dir / "python-cache"
    username = os.environ.get("USERNAME") or os.environ.get("USER") or "runpod"
    home_dir = os.environ.get("HOME") or str(temp_dir)

    env = dict(os.environ)
    env.update(
        {
            "HOME": home_dir,
            "USERPROFILE": env.get("USERPROFILE", home_dir),
            "USERNAME": username,
            "USER": env.get("USER", username),
            "LOGNAME": env.get("LOGNAME", username),
            "TORCHINDUCTOR_CACHE_DIR": env.get(
                "TORCHINDUCTOR_CACHE_DIR", str(cache_root / "torchinductor")
            ),
            "TORCH_HOME": env.get("TORCH_HOME", str(cache_root / "torch")),
            "XDG_CACHE_HOME": env.get("XDG_CACHE_HOME", str(cache_root / "xdg")),
            "PYTHONIOENCODING": "utf-8",
        }
    )

    Path(env["TORCHINDUCTOR_CACHE_DIR"]).mkdir(parents=True, exist_ok=True)
    Path(env["TORCH_HOME"]).mkdir(parents=True, exist_ok=True)
    Path(env["XDG_CACHE_HOME"]).mkdir(parents=True, exist_ok=True)

    return env


def write_input_file(job_input: dict, temp_dir: Path):
    filename = job_input.get("filename") or "input.mp4"
    suffix = Path(filename).suffix or ".mp4"
    input_path = temp_dir / f"input{suffix}"

    if isinstance(job_input.get("fileBase64"), str) and job_input["fileBase64"]:
        file_bytes = base64.b64decode(job_input["fileBase64"])
        input_path.write_bytes(file_bytes)
        return input_path

    if isinstance(job_input.get("sourceUrl"), str) and job_input["sourceUrl"]:
        with urlopen(job_input["sourceUrl"]) as response:
            input_path.write_bytes(response.read())
        return input_path

    raise ValueError("Expected fileBase64 or sourceUrl in Runpod input.")


def upload_result_if_requested(job_input: dict, output_bytes: bytes):
    result_upload_url = job_input.get("resultUploadUrl")
    if not isinstance(result_upload_url, str) or not result_upload_url:
        return None

    request = Request(
        result_upload_url,
        data=output_bytes,
        method="PUT",
        headers={"Content-Type": "video/mp4"},
    )
    with urlopen(request) as response:
        response.read()

    return {
        "resultStored": True,
        "resultMode": "signed-upload",
        "mimeType": "video/mp4",
    }


def run_watermark_remover(job_input: dict):
    ensure_worker_files()

    detection_prompt = str(job_input.get("detectionPrompt") or "watermark")
    detection_skip = int(job_input.get("detectionSkip") or 6)
    detection_skip = max(1, min(10, detection_skip))
    fade_in = str(job_input.get("fadeIn") or "0.0")
    fade_out = str(job_input.get("fadeOut") or "0.0")

    with tempfile.TemporaryDirectory(prefix="gsmediacut-runpod-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        input_path = write_input_file(job_input, temp_dir)
        output_path = temp_dir / "output_cleaned.mp4"
        env = build_env(temp_dir)

        command = [
            sys.executable,
            str(SCRIPT_PATH),
            str(input_path),
            str(output_path),
            "--overwrite",
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

        process = subprocess.run(
            command,
            cwd=str(VENDOR_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        if process.returncode != 0:
            raise RuntimeError(process.stderr or process.stdout or "WatermarkRemover-AI failed.")

        if not output_path.exists():
            raise FileNotFoundError("Worker finished without producing output_cleaned.mp4.")

        output_bytes = output_path.read_bytes()
        output_name = f"{Path(filename_or_default(job_input)).stem}_cleaned.mp4"
        uploaded_result = upload_result_if_requested(job_input, output_bytes)

        if uploaded_result:
            return {
                "filename": output_name,
                "engine": "watermarkremover-ai",
                "logs": process.stdout[-4000:],
                **uploaded_result,
            }

        return {
            "videoBase64": base64.b64encode(output_bytes).decode("utf-8"),
            "filename": output_name,
            "mimeType": "video/mp4",
            "engine": "watermarkremover-ai",
            "logs": process.stdout[-4000:],
        }


def filename_or_default(job_input: dict):
    return str(job_input.get("filename") or "input.mp4")


def handler(job):
    job_input = job.get("input", {}) or {}
    task = job_input.get("task")
    engine = job_input.get("engine")

    if task != "watermark_remove":
        return {"error": f"Unsupported task: {task}"}

    if engine not in {"watermarkremover-ai", "watermark-remover-ai", "ai"}:
        return {"error": f"Unsupported engine: {engine}"}

    try:
        result = run_watermark_remover(job_input)
        return result
    except Exception as error:  # noqa: BLE001
        return {"error": str(error)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
