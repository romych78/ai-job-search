---
name: stepstone-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German
  job listings, look up a specific posting on StepStone, or asks anything about the
  German job market — even if they don't mention stepstone.de explicitly. Invoke for
  open positions, vacancies, and hiring across any sector or role (software, data,
  engineering, executive/CTO, finance, sales, etc.) in Germany. StepStone is
  Germany's largest general job board. Trigger phrases: stepstone, stepstone.de,
  jobs in germany, german jobs, job search germany, stellenangebote, stellenanzeigen,
  jobsuche, jobbörse, offene stellen, jobs in berlin, jobs münchen, jobs hamburg,
  jobs frankfurt, jobs köln, find a job germany, vacancies germany, hiring germany,
  work in germany, look up this stepstone posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/stepstone-search/cli/src/cli.ts *)
---

# StepStone.de Search Skill

Search live job listings from **[www.stepstone.de](https://www.stepstone.de)**,
Germany's largest general job board. No authentication needed for search or job
detail. **Zero runtime dependencies** — it runs with just `bun`.

Both commands are robots.txt-compliant for this CLI's honest, self-identifying
User-Agent (`stepstone-search-cli/1.0`) — no personal-use warning needed. The
constraint that does apply: this CLI deliberately uses only the
`/jobs/<slug>?q=<query>` URL shape, because that's the one path StepStone's
robots.txt explicitly allows (`Allow: /jobs/*?q=*`); adding any second query
parameter (for recency, pagination, location, sort, etc.) or using
`/search-results`, `/listing`, or `/public-api/` would violate their stated policy
(`Disallow: /jobs/*?q*&*`, plus separate blanket disallows on those other paths).
See `url-reference.md` for the full robots.txt breakdown.

## When to use this skill

- Search for job openings in Germany by keyword, job title, or role (any sector)
- Get the full description of a specific job listing, including employment type
  and work mode (on-site / hybrid / remote)
- Explore the German job market for executive, tech, or any other role

## Commands

### Search job listings

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (job title, skill, role). **Required**
  — StepStone's allowed search URL is built directly from it.
- `--jobage <days>` — **not supported**, see Notes. Passing it exits 1 with `JOBAGE_UNSUPPORTED`.
- `--page <n>` — 1-indexed page. **Only page 1 is supported**, see Notes.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **Location note**: StepStone has no location parameter compatible with the one
> allowed URL shape. Include the city in `--query` instead, e.g.
> `--query "data engineer münchen"` — the same workaround `jobindex-search`
> documents for Jobindex.

### Fetch full job detail

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `14030156`). You may also
pass a full detail URL — any descriptive slug works, since StepStone resolves the
page from the trailing `--<id>-inline.html` regardless of what precedes it.
Returns the full job description, employment type, work mode, and posting date.

## Usage examples

```bash
# CTO / leadership roles nationwide
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "CTO" --format table

# Backend engineer roles in Berlin (city folded into the query — see Location note)
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "backend engineer berlin" --format table

# Data engineer roles in Munich
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "data engineer münchen" --format table

# Product manager roles, capped to 5 results
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "product manager" --limit 5 --format table

# Full-stack developer roles in Hamburg
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "full stack developer hamburg" --format json

# Full details for a specific job
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail 14030156 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from www.stepstone.de's public search and detail pages — no credentials required.
- **Search** parses the `window.__PRELOADED_STATE__["app-unifiedResultlist"]` JSON
  blob embedded in the search page (the same data StepStone's own front end renders
  from), not CSS-class HTML scraping — more resilient to markup changes.
- **Detail** parses the `window.__PRELOADED_STATE__.JobAdContent` blob's `props`
  value (a JS object literal with one strict-JSON value, not straight JSON — see
  `url-reference.md` for why that distinction matters for parsing).
- **`--jobage` is not supported.** StepStone's recency filter (`?ag=age_1` /
  `?ag=age_7`) requires a second query parameter alongside `q`, which robots.txt
  disallows for this CLI's honest User-Agent (`Disallow: /jobs/*?q*&*`).
- **Pagination is not supported beyond page 1.** Confirmed live: the site's own
  pagination links use either a bare `?page=N` (no `q=`, so it's outside the one
  allowed shape) or `?q=<query>&of=25...` (a second parameter after `q`, which
  `Disallow: /jobs/*?q*&*` explicitly blocks). `--page 2` and above return a
  `PAGINATION_UNSUPPORTED` error rather than a broken/empty result. Page 1
  (~25 results; `meta.total` in JSON output carries the true total count) is what's
  reachable.
- **No location parameter** — fold the city into `--query` (see the Location note above).
- **No application deadline** exists in StepStone's job-ad data model; `deadline`
  is always `null` in `detail` output.
- **No separate apply URL** — StepStone's apply flow is an in-page action, not a
  resolvable link; `applyUrl` is always `null` in `detail` output. The detail
  page's own URL is the entry point for a human to apply.
- Job IDs are plain numeric strings (e.g. `14030156`) — pass them as-is to `detail`,
  or pass a full detail URL with any slug.
- Postings are predominantly German, with some English-language postings for
  senior tech and executive roles.
