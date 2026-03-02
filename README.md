# Gitea-Sync

Cloudflare Worker that syncs GitHub repositories to Gitea mirror repositories.

## Behavior

- Lists all non-archived repositories owned by `GH_USERNAME` on GitHub.
- Lists all repositories in Gitea org `TEA_ORG`.
- Creates missing mirror repos in Gitea.
- Deletes repos in Gitea that no longer exist in GitHub.
- Unwatches all mirror repos in Gitea.

## Endpoints

- `GET /health` - health check
- `POST /sync` - manual sync trigger
  - If `SYNC_TRIGGER_TOKEN` is set, send `Authorization: Bearer <token>`

## Configuration

Set all runtime values as Worker secrets (do not commit values in `wrangler.jsonc`):

- `GH_USERNAME`
- `GH_TOKEN`
- `TEA_URL`
- `TEA_TOKEN`
- `TEA_ORG`
- `SYNC_TRIGGER_TOKEN` (optional)
- `WORKER_NAME` is configured in `wrangler.jsonc` for structured observability logs
- `OBS_SERVICE` service binding is required and configured in `wrangler.jsonc`

Example:

```bash
wrangler secret put GH_USERNAME
wrangler secret put GH_TOKEN
wrangler secret put TEA_URL
wrangler secret put TEA_TOKEN
wrangler secret put TEA_ORG
wrangler secret put SYNC_TRIGGER_TOKEN
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill real values.

## Local dev

```bash
npm run dev -- --test-scheduled
```

Manual trigger:

```bash
curl -X POST http://localhost:8787/sync
```

Health check:

```bash
curl http://localhost:8787/health
```

## Deploy

```bash
npm run deploy
```
