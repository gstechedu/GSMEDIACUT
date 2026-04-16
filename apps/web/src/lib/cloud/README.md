# Cloud Integrations

This project now includes server-side integration points for:

- Runpod async/sync job submission and status polling
- Cloudflare R2 temporary upload support for large Runpod source and result files

## Routes

- `POST /api/cloud/runpod/jobs`
- `GET /api/cloud/runpod/jobs/:jobId`

## Example Runpod async request

```json
{
  "mode": "async",
  "input": {
    "sourceUrl": "https://example.com/video.mp4",
    "task": "watermark-remove"
  }
}
```

## Typical flow

1. Submit a Runpod job with your media URL or task payload.
2. Poll `/api/cloud/runpod/jobs/:jobId` until the job finishes.
3. Save the output URL or result back into project metadata or import it into Media.

## Watermark AI large-file flow

When `R2_*` variables are configured, watermark AI jobs upload the source clip to:

- `temp-uploads/<uuid>.mp4`
- `temp-results/<uuid>.mp4`

The API generates:

- a signed source download URL for Runpod
- a signed result upload URL for Runpod

Runpod downloads the raw clip from `temp-uploads/`, writes the cleaned result to `temp-results/`, and the app imports the result before deleting both objects immediately.

You should also add an R2 lifecycle rule in Cloudflare:

- Prefix: `temp-uploads/`
- Action: expire objects after `1 day`
- Prefix: `temp-results/`
- Action: expire objects after `1 day`

That gives you a 24-hour safety cleanup window even if a job crashes before the app deletes the temp objects.
