# Gitea-Sync Worker

## Overview

Cloudflare Worker that mirrors GitHub repos to Gitea on an hourly cron. Entry point is `src/index.ts`.

## Docs

- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
- Gitea API: refer to the target instance's `/api/swagger`
- MCP: <https://docs.mcp.cloudflare.com/mcp>

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers task.

## Commands

| Command                            | Purpose                                      |
| ---------------------------------- | -------------------------------------------- |
| `pnpm run dev`                     | Local development (`wrangler dev`)           |
| `pnpm run dev -- --test-scheduled` | Test cron trigger locally                    |
| `pnpm run test`                    | Run tests (`vitest`)                         |
| `pnpm run deploy`                  | Deploy to Cloudflare (`wrangler deploy`)     |
| `pnpm run cf-typegen`              | Generate TypeScript types (`wrangler types`) |

Run `pnpm run cf-typegen` after changing bindings in `wrangler.jsonc`.

## Architecture

- `src/index.ts` — Worker entry point with `fetch` and `scheduled` handlers, plus all sync logic (GitHub fetch, Gitea mirror CRUD, unwatch).
- `src/observability.ts` — Structured logging (`logInfo`, `logWarn`, `logError`) and error forwarding to `OBS_SERVICE` binding.
- `src/types.ts` — `Env` interface and observability payload types.

## Key Patterns

- All secrets (`GH_TOKEN`, `TEA_TOKEN`, etc.) come from Worker secrets, not `wrangler.jsonc` vars.
- The `OBS_SERVICE` service binding connects to `workers-observability-hub` for error reporting.
- GitHub API pagination uses `per_page=100`; Gitea uses `limit=50`.
- Mirror creation uses Gitea's `/repos/migrate` endpoint with `mirror: true`.
- Response bodies are truncated to 4000 chars in error logs.

## Node.js Compatibility

`nodejs_compat` flag is enabled. Reference: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: <https://developers.cloudflare.com/workers/observability/errors/>
