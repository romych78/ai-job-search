# indeed-de-cli

CLI for searching jobs on **[de.indeed.com](https://de.indeed.com)**, Germany's largest
job aggregator.

**Data source**: de.indeed.com's public search page (`/jobs?q=...`) and job detail page
(`/viewjob?jk=...`). Both embed structured JSON the CLI parses directly (a
`window.mosaic.providerData[...]` blob on search, a schema.org JobPosting
`<script type="application/ld+json">` block on detail) rather than scraping CSS classes.
**Authentication**: None required for page 1 of search results or for `detail`.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** `detail` (`/viewjob?jk=...`) sits outside de.indeed.com's
> robots.txt allowance for this CLI's honest, self-identifying User-Agent. Keep volume
> low, don't use it commercially or for bulk data collection, and run it on your own
> responsibility. See `../SKILL.md` for the full caveat.

## Installation

```bash
cd .agents/skills/indeed-de-search/cli
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
# CTO roles nationwide, last 14 days
bun run src/cli.ts search -q "CTO" --jobage 14 --format table

# Backend roles in Berlin
bun run src/cli.ts search -q "backend engineer" -l "Berlin" --format table

# Full detail for one job
bun run src/cli.ts detail 48ee97925d1c9ac5 --format plain
```

See `../SKILL.md` for the full flag reference and the robots.txt / anonymous-access notes.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--location` | `-l` | Place string, e.g. `"Berlin"`, `"München"`, `"Deutschland"` (default). |
| `--jobage` | | Posted within N days (maps to Indeed's `fromage`). |
| `--page` | | 1-indexed page. **Only page 1 is supported** — see Notes. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- **Pagination**: requesting `--page` 2 or higher returns a `PAGINATION_UNSUPPORTED` error
  instead of a request. Confirmed live: Indeed redirects anonymous/unauthenticated requests
  carrying `&start=` to a `secure.indeed.com/auth` sign-in page. robots.txt separately
  disallows `&start=` for this CLI's `User-Agent: *` bucket. Page 1 (up to ~15 results,
  mixing organic and sponsored listings) is all that's reachable without a session.
- **Detail endpoint**: robots.txt disallows `/viewjob?` for the generic `User-Agent: *`
  bucket (the bucket this CLI's honest UA falls into) — Indeed only carves out that path
  for a named allowlist of AI-agent crawlers (`PerplexityBot`, `Claude-User`,
  `Claude-SearchBot`, `OAI-SearchBot`, etc.), which this CLI does not impersonate.
