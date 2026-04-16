FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV WATERMARK_REMOVER_REPO=https://github.com/D-Ogi/WatermarkRemover-AI
ENV WATERMARK_REMOVER_REF=2a15d4d51a483a9fdc8437ec52b1146319d9bda9

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
    python3 -m pip install --no-deps iopaint

COPY runpod/watermark-worker /app/runpod/watermark-worker

RUN git clone ${WATERMARK_REMOVER_REPO} /app/vendor/WatermarkRemover-AI && \
    cd /app/vendor/WatermarkRemover-AI && \
    git checkout ${WATERMARK_REMOVER_REF}

CMD ["python3", "/app/runpod/watermark-worker/handler.py"]
