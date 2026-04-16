# Cloud Integrations

This project now includes server-side integration points for:

- Runpod async/sync job submission and status polling

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
