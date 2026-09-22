# xing-cli

CLI for searching jobs on **Xing**, the German/DACH-region professional network
(LinkedIn's regional analog), covering Germany, Austria, and Switzerland.

**Data source**: Xing's server-rendered Apollo/GraphQL cache, embedded as JSON in every
page (`window.crate` inside `<script id="runtime-config">`) — parsed directly rather than
regex-scraping the visible HTML, since the cache shape is far more stable than Xing's
hashed styled-components class names.
**Authentication**: None required for search or job detail.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **⚠️ Personal use only.** Xing's `robots.txt` disallows `/jobs/search/` and
> `/jobs/search?*` for the generic `User-agent: *` bucket (only a named list of AI
> crawlers — GPTBot, ClaudeBot, PerplexityBot, etc. — get an explicit `Allow`, and this
> tool honestly does not claim to be one of them). Keep volume low, never use this
> commercially or for bulk data collection, and run it entirely on your own
> responsibility.

## Installation

```bash
cd .agents/skills/xing-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# CTO roles anywhere in the DACH region
bun run src/cli.ts search -q "CTO" --format table

# Data engineer roles in Berlin, last 14 days
bun run src/cli.ts search -q "data engineer" -l "Berlin" --jobage 14 --format table

# Full detail for one job (id/url comes from a search result)
bun run src/cli.ts detail hamburg-cto-154939702 --format plain
```

See `../SKILL.md` for the full flag reference and the robots.txt note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | Free-text place (city or region), e.g. `"Berlin"`, `"München"`. |
| `--jobage` | | Posted within N days — applied **client-side** to the fetched page (see Notes in SKILL.md). |
| `--page` | | 1-indexed page (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## `id` is a slug, not a bare number

Xing's job-detail URLs require the exact slug (e.g. `hamburg-cto-154939702`) — a bare
numeric ID alone gets interpreted as a search keyword, not a lookup key, and a
right-shaped-but-wrong slug returns HTTP 410. So `search` results carry the full slug as
`id`; pass that (or the full `url`) straight to `detail`.
