# experteer-cli

CLI for searching jobs on **Experteer**, Germany's leading job board for executive and
senior-level roles (director, VP, C-level, Geschäftsführer).

**Data source**: Experteer's public search-results page (server-rendered Rails +
AngularJS HTML) and its separately-stacked Next.js detail page, which embeds a
schema.org `JobPosting` block as JSON in a hydration script — parsed directly rather
than scraping hashed CSS-module class names.
**Authentication**: None required for search or job detail.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

Both `search` and `detail` are fully robots.txt-compliant for this CLI's honest,
self-identifying User-Agent (`experteer-search-cli/1.0`) — no personal-use warning
needed. See `../SKILL.md` and `../url-reference.md` for the full breakdown.

## Installation

```bash
cd .agents/skills/experteer-search/cli
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
# CTO / executive tech roles anywhere in Germany
bun run src/cli.ts search -q "CTO" --format table

# Geschäftsführer roles, posted in the last 30 days
bun run src/cli.ts search -q "Geschäftsführer" --jobage 30 --format table

# Full detail for one job (id/url comes from a search result)
bun run src/cli.ts detail 59148463 --format plain
```

See `../SKILL.md` for the full flag reference and portal notes.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keywords (title / skill / role). Include the city here too — see Location note below. |
| `--jobage` | | Posted within N days — a genuine server-side filter (Experteer's own `since_days` param). |
| `--page` | | 1-indexed page (25 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Location is query-only

Experteer has no location URL parameter that changes the result set (`location`,
`city`, `ort`, `standort`, `region`, and `geocode[location]` were all probed live and
found inert). Fold the city into `--query` instead, e.g. `-q "CTO Berlin"` — confirmed
live to genuinely narrow results.

## Company name is detail-only

`search` results always report `company: null` — Experteer gates the employer name on
search cards behind a signup wall. The real name is available via `detail`, which
reads it from the portal's own unguarded schema.org data.

## `id` is a plain numeric string

Experteer resolves a job from its trailing numeric ID regardless of the descriptive
slug around it (a wrong slug with the right ID redirects to the canonical URL; a bare
ID alone also resolves directly). `search` results carry the bare ID as `id`; pass
that (or the full `url`) straight to `detail`.
