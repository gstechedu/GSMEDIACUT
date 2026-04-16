# Runpod Watermark Worker

This worker runs `WatermarkRemover-AI/remwm.py` on a Runpod Serverless GPU endpoint.

## Repo layout

Keep this folder in the same repository as:

- `runpod/watermark-worker`

The Dockerfile clones `D-Ogi/WatermarkRemover-AI` during the Runpod build, so you do not need to commit the `vendor/WatermarkRemover-AI` folder to GitHub.

## Runpod deployment

Use:

- `Custom deployment`
- `Deploy from GitHub`
- repo: `nutrothcode/GSMEDIACUT`

Set the Dockerfile path to:

```text
runpod/watermark-worker/Dockerfile
```

Use the repository root as the build context.

## Expected input

`GSMEDIACUT` sends this shape:

```json
{
  "task": "watermark_remove",
  "engine": "watermarkremover-ai",
  "filename": "clip.mp4",
  "mimeType": "video/mp4",
  "fileBase64": "...",
  "detectionPrompt": "watermark",
  "detectionSkip": 6,
  "fadeIn": "0.0",
  "fadeOut": "0.0"
}
```

The worker also accepts:

```json
{
  "sourceUrl": "https://example.com/video.mp4"
}
```

instead of `fileBase64`.

## Output

The worker returns:

```json
{
  "videoBase64": "...",
  "filename": "clip_cleaned.mp4",
  "mimeType": "video/mp4",
  "engine": "watermarkremover-ai"
}
```

This matches the Runpod parsing logic already added in `apps/web/src/app/api/watermark/run/route.ts`.
