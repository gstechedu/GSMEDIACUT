# GSMEDIACUT

`GSMEDIACUT` is now seeded from [OpenCut](https://github.com/OpenCut-app/OpenCut), which gives this repository a real offline-first video editor base for web and desktop instead of an empty placeholder repo.

## What is in this repo

- `apps/web/`: Next.js editor app from OpenCut
- `apps/desktop/`: Rust desktop shell from OpenCut
- `rust/`: shared Rust and WASM code
- `script/bootstrap-feature-repos.ps1`: clones the external feature repos you listed into `vendor/`
- `docs/feature-integration-plan.md`: maps each external repo to the place it belongs in this codebase

## Current status

- The app source is present locally.
- The repo has not been built yet on this machine.
- `bun` is not installed in this environment, so dependency install and local run were not possible yet.

## First setup on this machine

1. Install Bun: https://bun.sh/docs/installation
2. Copy the web env file:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

3. Optional: start Docker services used by the web app:

```powershell
docker compose up -d db redis serverless-redis-http
```

4. Install app dependencies:

```powershell
bun install
```

5. Start the editor:

```powershell
bun dev:web
```

## Pull the extra feature repos

Run this from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\bootstrap-feature-repos.ps1
```

That script clones the verified upstream repos into `vendor/` so you can reference their code, licenses, shaders, caption ideas, and platform implementations locally.

## Notes

- This is a strong base, not a finished CapCut clone.
- CapCut parity requires substantial work across editing UX, rendering, captions, effects, packaging, and licensing review.
- Start with the OpenCut app running first, then integrate captions, stickers, transitions, and packaging one layer at a time.

## License

This repo contains upstream OpenCut code under the license shipped in [LICENSE](LICENSE). Keep each vendored dependency under its own original license terms.
