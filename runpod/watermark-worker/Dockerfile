FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV TORCH_HOME=/root/.cache/torch
ENV XDG_CACHE_HOME=/root/.cache
ENV WATERMARK_REMOVER_REPO=https://github.com/D-Ogi/WatermarkRemover-AI
ENV WATERMARK_REMOVER_REF=2a15d4d51a483a9fdc8437ec52b1146319d9bda9
ENV FORCE_REBUILD=florence2-v7
ENV PRELOAD_LAMA_MODEL=0

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    ffmpeg \
    git \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY runpod/watermark-worker/requirements.txt /tmp/requirements.txt

RUN python3 -m pip install --upgrade pip setuptools wheel && \
    python3 -m pip install -r /tmp/requirements.txt && \
    python3 -m pip install iopaint && \
    python3 -m pip uninstall -y transformers huggingface_hub && \
    python3 -m pip install --no-cache-dir "transformers==4.57.0" "huggingface_hub==0.36.0"

COPY runpod/watermark-worker /app/runpod/watermark-worker

RUN mkdir -p /app/vendor/WatermarkRemover-AI && \
    cd /app/vendor/WatermarkRemover-AI && \
    git init && \
    git remote add origin ${WATERMARK_REMOVER_REPO} && \
    git fetch --depth 1 origin ${WATERMARK_REMOVER_REF} && \
    git checkout FETCH_HEAD

RUN python3 - <<'PY'
from pathlib import Path

path = Path("/app/vendor/WatermarkRemover-AI/remwm.py")
source = path.read_text(encoding="utf-8")
source = source.replace(
    "from transformers import AutoProcessor, Florence2ForConditionalGeneration",
    "from transformers import AutoModelForCausalLM, AutoProcessor",
)
source = source.replace(
    "def identify(task_prompt: TaskType, image: MatLike, text_input: str, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str):",
    "def identify(task_prompt: TaskType, image: MatLike, text_input: str, model: Module, processor: AutoProcessor, device: str):",
)
source = source.replace(
    "def get_watermark_mask(image: MatLike, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = \"watermark\"):",
    "def get_watermark_mask(image: MatLike, model: Module, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = \"watermark\"):",
)
source = source.replace(
    "def detect_only(image: MatLike, model: Florence2ForConditionalGeneration, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = \"watermark\"):",
    "def detect_only(image: MatLike, model: Module, processor: AutoProcessor, device: str, max_bbox_percent: float, detection_prompt: str = \"watermark\"):",
)
source = source.replace(
    "Florence2ForConditionalGeneration.from_pretrained(",
    "AutoModelForCausalLM.from_pretrained(",
)
source = source.replace(
    "\"florence-community/Florence-2-large\",\n            torch_dtype=model_dtype).to(device).eval()",
    "\"florence-community/Florence-2-large\",\n            trust_remote_code=True,\n            torch_dtype=model_dtype).to(device).eval()",
)
path.write_text(source, encoding="utf-8")
print("Patched WatermarkRemover-AI for AutoModelForCausalLM loading")
PY

RUN python3 - <<'PY'
from transformers import AutoModelForCausalLM, AutoProcessor
print("Transformers Florence import OK via AutoModelForCausalLM")
PY

RUN if [ "$PRELOAD_LAMA_MODEL" = "1" ]; then \
    python3 -c "import huggingface_hub; \
if not hasattr(huggingface_hub, 'cached_download'): \
    huggingface_hub.cached_download = huggingface_hub.hf_hub_download; \
from iopaint.download import cli_download_model; \
cli_download_model('lama')"; \
    else \
    echo "Skipping LaMa predownload during build"; \
    fi

CMD ["python3", "/app/runpod/watermark-worker/handler.py"]
