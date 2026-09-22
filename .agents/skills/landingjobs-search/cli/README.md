# landingjobs-cli

CLI for searching jobs on **landing.jobs**, a European tech-jobs board (strong
Portugal/startup and scale-up coverage, remote-friendly).

**Data source**: landing.jobs's own keyword-search endpoint (`/jobs/search`,
`/jobs/search.json`) is `Disallow`'d in `robots.txt` for every user-agent, so this
CLI never calls it. Instead it treats `sitemap.xml` — which `robots.txt` itself
points crawlers at via a `Sitemap:` directive — as the public job index: every
live `/at/<company-slug>/<job-slug>` posting is listed there with a `<lastmod>`.
`search` filters that index by keyword against the company+job slug, then
fetches each matching posting's detail page (also not `Disallow`'d) for the real
title/company/location/date, parsing the React-on-Rails `jobPage/JobPage` props
JSON embedded in the page rather than the visible HTML.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

No personal-use warning is needed — every path this CLI touches (`sitemap.xml`,
`/at/...`) is explicitly allowed by `robots.txt`. Keep volume reasonable anyway;
the CLI caps live detail-page fetches per `search` call (see Notes in `../SKILL.md`).

## Installation

```bash
cd .agents/skills/landingjobs-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (via the sitemap index + detail fetch) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Python roles anywhere on the board
bun run src/cli.ts search -q "python" --format table

# Java developer roles in Lisbon
bun run src/cli.ts search -q "java developer" -l "Lisbon" --format table

# Full detail for one job (id comes from a search result)
bun run src/cli.ts detail we-are-meta/staff-python-engineer --format plain
```

See `../SKILL.md` for the full flag reference and the sitemap-based search design.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role) — matched (AND across words) against each posting's company+job slug. |
| `--location` | `-l` | Free-text place, checked against the posting's resolved location after fetch. |
| `--jobage` | | Posted/updated within N days — checked against the sitemap's `<lastmod>` before fetching. |
| `--page` | | 1-indexed page (default page size 10). |
| `--limit` | `-n` | Results per page. |
| `--format` | | `json` \| `table` \| `plain`. |

## `id` is `<company-slug>/<job-slug>`, not a bare number

landing.jobs job-detail URLs are `/at/<company-slug>/<job-slug>` — `search` results
carry `<company-slug>/<job-slug>` as `id`; pass that (or the full `url`) straight
to `detail`.
