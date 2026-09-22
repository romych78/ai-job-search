---
name: indeed-de-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German
  job listings, look up a specific posting on Indeed, or asks anything about the
  German job market — even if they don't mention indeed.de or de.indeed.com
  explicitly. Invoke for open positions, vacancies, and hiring across any sector or
  role (software, data, engineering, executive/CTO, finance, sales, etc.) in Germany.
  Trigger phrases: indeed, indeed.de, jobs in germany, german jobs, job search
  germany, stellenangebote, stellenanzeigen, jobsuche, jobbörse, offene stellen,
  jobs in berlin, jobs münchen, jobs hamburg, jobs frankfurt, jobs köln, find a job
  germany, vacancies germany, hiring germany, work in germany, look up this indeed
  posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/indeed-de-search/cli/src/cli.ts *)
---

# Indeed.de Search Skill

Search live job listings from **[de.indeed.com](https://de.indeed.com)**, one of
Germany's largest job aggregators. No authentication needed for page 1 of search
results or for job detail. **Zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

This CLI checked de.indeed.com's robots.txt carefully before being built:

- **`search` (page 1, `/jobs?q=...&l=...`) is robots.txt-compliant** for this CLI's
  honest, self-identifying User-Agent (`indeed-de-search-cli/1.0`) — the generic
  `User-Agent: *` bucket disallows country-path variants like `/jobs/DE/` and
  `/jobs/title`, but not the bare `/jobs?q=...` query form this CLI uses.
- **`detail` (`/viewjob?jk=...`) sits OUTSIDE that allowance.** robots.txt disallows
  `/viewjob?` for the generic bucket. Indeed only carves out that path for a named
  allowlist of AI-agent crawlers (`PerplexityBot`, `Claude-User`, `Claude-SearchBot`,
  `OAI-SearchBot`, and similar) — this CLI does not impersonate those, so `detail`
  requests fall outside Indeed's robots.txt allowance for an honest UA.
- **Pagination beyond page 1 doesn't work at all for anonymous requests** — confirmed
  live: requesting `&start=10` redirects to a `secure.indeed.com/auth` sign-in page.
  robots.txt separately disallows `&start=` for this bucket too.

Because of that, treat `detail` as sitting outside Indeed's stated policy for a
generic, honestly-identified tool: **keep volume very low (a handful of requests,
never a crawl), use this for your own personal job search only, never commercially or
for bulk data collection, and run it on your own responsibility.**

## When to use this skill

- Search for job openings in Germany by keyword, job title, or role (any sector)
- Narrow to a specific German city or region via `--location`
- Filter by recency (posted today / last 7 / 14 / 30 days)
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/indeed-de-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (job title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — a German place string, e.g. `"Berlin"`, `"München"`,
  `"Hamburg"`, or `"Deutschland"` for nationwide (default).
- `--jobage <days>` — posted within N days (maps to Indeed's `fromage` parameter). Omit for all postings.
- `--page <n>` — 1-indexed page. **Only page 1 is supported** — see Notes.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/indeed-de-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job key from `search` results (e.g. `48ee97925d1c9ac5`). You may also pass
a full `/viewjob?jk=...` URL, or any URL containing a `jk=` parameter. Returns the full
description, employment type, posting date, and application deadline (`validThrough`).

## Usage examples

```bash
# CTO / leadership roles nationwide, last 14 days
bun run .agents/skills/indeed-de-search/cli/src/cli.ts search -q "CTO" --jobage 14 --format table

# Backend engineer roles in Berlin
bun run .agents/skills/indeed-de-search/cli/src/cli.ts search -q "backend engineer" -l "Berlin" --format table

# Data engineer roles in Munich, posted this week
bun run .agents/skills/indeed-de-search/cli/src/cli.ts search -q "data engineer" -l "München" --jobage 7 --format table

# Any role in Hamburg
bun run .agents/skills/indeed-de-search/cli/src/cli.ts search -l "Hamburg" --limit 10 --format table

# Full details for a specific job
bun run .agents/skills/indeed-de-search/cli/src/cli.ts detail 48ee97925d1c9ac5 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from de.indeed.com's public search and detail pages — no credentials required
  for anything this CLI does.
- **Search** parses the `window.mosaic.providerData["mosaic-provider-jobcards"]` JSON
  blob embedded in the search page (the same data Indeed's React front end renders
  from), not CSS-class HTML scraping — more resilient to markup changes.
- **Detail** parses the schema.org `<script type="application/ld+json">` `JobPosting`
  block embedded in the detail page (the structured data Indeed maintains for
  Google-for-Jobs). Falls back to the raw `#jobDescriptionText` div for the
  description, and to plain-text literals for company/location, if that block is
  missing (see the sponsored-listings note below).
- **Dates**: `date` is normalized to an ISO `YYYY-MM-DD` string from Indeed's internal
  timestamp; the raw relative string Indeed shows in the UI (e.g. `"vor 3 Tagen"`,
  `"Gerade geschaltet"`) is passed through unchanged as `relativeDate`.
- **Pagination is not supported beyond page 1.** Confirmed live: an anonymous request
  with `&start=10` redirects to `secure.indeed.com/auth` (sign-in required), and
  robots.txt separately disallows `&start=` for this User-Agent bucket. `--page 2`
  and above return a `PAGINATION_UNSUPPORTED` error rather than a broken/empty result.
  Page 1 mixes organic and sponsored ("gesponsert") listings, typically ~15 results.
- Job keys are 16-character hex strings (e.g. `48ee97925d1c9ac5`) — pass them as-is to `detail`.
- Postings are mixed German/English, especially for senior/executive and tech roles.
- **Indeed's Cloudflare bot-check intermittently blocks legitimate requests** —
  confirmed live, including from plain `curl` with no automation markers, alternating
  between success and either an HTTP 403 or an HTTP 200 that's actually a "Security
  Check" challenge page (not the job posting). The CLI retries both cases with the
  same exponential backoff as 429/5xx. A `detail` or `search` call may take a few
  seconds longer than expected if it hits this; that's normal, not a bug.
- **Sponsored/"gesponsert" listings sometimes omit structured data entirely** —
  `detail` falls back to parsing plain-text fields out of the page for `company` and
  `location` on those, but `date`, `deadline`, and `employmentType` come back `null`
  for that subset (they're only available in the structured block most, but not all,
  postings carry). See `url-reference.md` for specifics.
