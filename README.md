# Gitea-Sync

Cloudflare Worker that automatically mirrors GitHub repositories to a Gitea instance. Runs on a hourly cron schedule and supports manual triggers.

## Behavior

- Lists all non-archived repositories owned by `GH_USERNAME` on GitHub.
- Lists all repositories in Gitea org `TEA_ORG`.
- Creates missing mirror repos in Gitea (including PRs, releases, milestones, wikis).
- Deletes repos in Gitea that no longer exist in GitHub.
- Unwatches all mirror repos in Gitea.
- Logs structured observability events and forwards errors to an external observability service.

## Endpoints

| Method | Path      | Description                                                                                   |
| ------ | --------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/health` | Health check                                                                                  |
| `POST` | `/sync`   | Manual sync trigger (requires `Authorization: Bearer <token>` if `SYNC_TRIGGER_TOKEN` is set) |

## Scheduled Trigger

A cron trigger runs the sync every hour (`0 * * * *`), configured in `wrangler.jsonc`.

## Configuration

Set all runtime values as Worker secrets (do not commit values in `wrangler.jsonc`):

| Variable             | Required | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| `GH_USERNAME`        | Yes      | GitHub username                              |
| `GH_TOKEN`           | Yes      | GitHub personal access token                 |
| `TEA_URL`            | Yes      | Gitea instance URL                           |
| `TEA_TOKEN`          | Yes      | Gitea API token                              |
| `TEA_ORG`            | Yes      | Gitea organization to mirror into            |
| `SYNC_TRIGGER_TOKEN` | No       | Bearer token to protect the `/sync` endpoint |

Additional config in `wrangler.jsonc`:

- `WORKER_NAME` — var used in structured log events
- `OBS_SERVICE` — service binding to `workers-observability-hub`

```bash
wrangler secret put GH_USERNAME
wrangler secret put GH_TOKEN
wrangler secret put TEA_URL
wrangler secret put TEA_TOKEN
wrangler secret put TEA_ORG
wrangler secret put SYNC_TRIGGER_TOKEN
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill real values.

## Development

```bash
npm run dev              # start local dev server
npm run dev -- --test-scheduled  # test cron trigger locally
npm run test             # run tests with vitest
```

Manual trigger:

```bash
curl -X POST http://localhost:8787/sync
curl http://localhost:8787/health
```

## Deploy

```bash
npm run deploy
```

## Project Structure

```text
src/
  index.ts          # Worker entry: fetch handler, scheduled handler, sync logic
  observability.ts  # Structured logging and error reporting
  types.ts          # Env and observability type definitions
```
