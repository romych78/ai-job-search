# stepstone-cli

CLI for searching jobs on **[www.stepstone.de](https://www.stepstone.de)**, Germany's
largest general job board.

**Data source**: www.stepstone.de's public search page (`/jobs/<slug>?q=...`) and job
detail page (`/stellenangebote--...-inline.html`). Both embed StepStone's own SSR
hydration state (`window.__PRELOADED_STATE__[...]`) as inline JSON, which the CLI
parses directly rather than scraping CSS classes.
**Authentication**: None required for either command.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

Both `search` (page 1) and `detail` are robots.txt-compliant for this CLI's honest,
self-identifying User-Agent (`stepstone-search-cli/1.0`) — see `../SKILL.md` and
`../url-reference.md` for the full robots.txt analysis. Recency filtering and
pagination beyond page 1 are **not** supported: both require a second query
parameter alongside `q`, which robots.txt disallows (`Disallow: /jobs/*?q*&*`).

## Installation

```bash
cd .agents/skills/stepstone-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (page 1 only — see Notes) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# CTO / leadership roles nationwide
bun run src/cli.ts search -q "CTO" --format table

# Data engineer roles, keeping the city inside the query (see Notes)
bun run src/cli.ts search -q "data engineer münchen" --limit 10 --format table

# Full detail for one job
bun run src/cli.ts detail 14030156 --format plain
```

See `../SKILL.md` for the full flag reference and the robots.txt notes.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keywords (title / skill / role). **Required** — StepStone's allowed search URL is built from it. |
| `--jobage` | | **Not supported.** Passing it exits 1 with `JOBAGE_UNSUPPORTED`. |
| `--page` | | 1-indexed page. **Only page 1 is supported** — see Notes. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- **No location parameter.** StepStone has no location filter compatible with the
  one allowed URL shape (`/jobs/<slug>?q=<query>` — any second parameter is
  robots.txt-disallowed). Include the city in `--query` instead, e.g.
  `-q "data engineer münchen"` — the same workaround `jobindex-search` documents.
- **`--jobage` is not supported.** StepStone's recency filter (`?ag=age_1` for last
  24h, `?ag=age_7` for last 7 days) requires a second query parameter alongside `q`,
  which robots.txt disallows for this CLI's honest User-Agent
  (`Disallow: /jobs/*?q*&*`).
- **Pagination**: requesting `--page` 2 or higher returns a `PAGINATION_UNSUPPORTED`
  error instead of a request — StepStone's `page`/`of` pagination parameter has the
  same second-parameter problem as recency filtering. Page 1 (up to ~25 results) is
  all that's reachable while staying robots.txt-compliant.
- The descriptive part of a detail URL's slug is cosmetic — confirmed live,
  StepStone resolves the page from the trailing `--<id>-inline.html` regardless of
  what precedes it — so `detail` builds a synthetic minimal URL from the ID rather
  than depending on a caller-supplied slug.
