---
name: xing-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs on Xing, the German/DACH-region
  professional network (LinkedIn's regional analog), or look up a specific Xing job posting —
  for Germany, Austria, or Switzerland. Invoke for open positions, vacancies, and hiring across
  any sector or role. Trigger phrases: Xing jobs, search Xing, Xing Jobsuche, Stellenangebote
  auf Xing, offene Stellen, Jobsuche, Stellenanzeigen, "jobs on Xing", "find a job on Xing",
  look up this Xing job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/xing-search/cli/src/cli.ts *)
---

# Xing Search Skill

Search live job listings from Xing's public job board, for the **German/DACH region**
(Germany, Austria, Switzerland). No authentication, no API key, and **zero runtime
dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

Xing's `robots.txt` **disallows** `/jobs/search/` and `/jobs/search?*` for the generic
`User-agent: *` bucket. It carves out an explicit `Allow` for those same paths, but only
for a named list of AI crawlers (`GPTBot`, `GPTUser`, `ClaudeBot`, `Claude-User`,
`PerplexityBot`, `Perplexity-User`). This skill identifies itself with an honest,
non-impersonating User-Agent (`xing-search-cli/1.0`) rather than claiming to be one of
those named crawlers, so it falls under the **disallowed** generic bucket for the search
path. (The job-*detail* pages it also fetches are not covered by that disallow rule.)

**Use this at low volume, for personal use only — never commercially, never in bulk — and
entirely at your own responsibility.** This was a deliberate, informed choice to proceed
despite the disallow; if that changes, disable this skill via `enabled: false` above.

## When to use this skill

- Search for job openings in Germany, Austria, or Switzerland
- Filter by recency (best-effort, see Notes) or free-text location
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/xing-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role).
- `--location <text>` / `-l <text>` — free-text place, e.g. `"Berlin"`, `"München"`, `"Wien"`, `"Zürich"`.
- `--jobage <days>` — posted within N days, applied **client-side** to the fetched page (see Notes — Xing has no server-side date parameter).
- `--page <n>` — page number (1-indexed, 20 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/xing-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job **slug** from `search` results (e.g. `hamburg-cto-154939702` — Xing's
detail pages require the exact slug, a bare numeric ID is not a valid lookup key). You may
also pass a full `xing.com/jobs/...` URL. Returns the full description, employment type,
salary estimate (when Xing shows one), and the employer's direct apply link.

## Usage examples

```bash
# CTO roles anywhere in the DACH region
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "CTO" --format table

# Data engineer roles in Berlin, last 14 days
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "data engineer" -l "Berlin" --jobage 14 --format table

# Product manager roles in Vienna
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "product manager" -l "Wien" --format table

# Second page of results for a broad query
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "Geschäftsführer" --page 2 --format table

# Full details for a specific job
bun run .agents/skills/xing-search/cli/src/cli.ts detail hamburg-cto-154939702 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Data source**: Xing server-renders a GraphQL/Apollo cache into every page as JSON
  (`window.crate` inside a `<script id="runtime-config">` tag). The CLI parses that JSON
  directly rather than regex-scraping the visible HTML, since Xing's styled-components
  class names are hashed and shift on every deploy while the cache shape is stable.
- **Search is genuinely public and complete** — no login wall, no teaser/blurred results.
  A quick check against `www.xing.com/jobs/search?keywords=...` (which 301s to
  `/jobs/search/ki?keywords=...`) returned real, full job cards (title, company, city,
  employment type, salary range, publish date) without authentication, confirmed against
  a live "CTO" query.
- **Detail pages are also public and complete** — the full HTML job description, salary,
  and the employer's apply URL are all present without login (verified against a live job).
- **No total-result count.** Xing's search API returns `total: -1` in "semantic" search
  mode; `meta.count` in this CLI's output is just the number of results on the current
  page (after `--jobage`/`--limit` filtering), not a portal-wide total.
- **`--jobage` is client-side only.** Xing's UI has a "Veröffentlicht" (posted-within)
  filter with fixed buckets (24h / week / month), but it's a JS-only control — probing a
  `?age=`-style query parameter confirmed the server ignores it. This CLI instead filters
  the *already-fetched page* of results by each job's `refreshedAt` timestamp. That means
  a tight `--jobage` on a broad query can return fewer results than `--limit` requests;
  pair it with `--page` to keep scanning if you need more matches.
- **`--location` is a genuine server-side filter** — confirmed live: `-l "Berlin"` changed
  both the result set and the GraphQL query body (`location.text`), not just cosmetic
  re-ranking.
- **Fixed page size**: 20 results per page, confirmed via `--page 2` shifting the
  server-side `offset` from 0 to 20.
- Postings are a mix of German and English; some list only career-level/salary bands
  without a company name (`companyNameOverride: "confidential"` in Xing's own data, not a
  parsing gap).
