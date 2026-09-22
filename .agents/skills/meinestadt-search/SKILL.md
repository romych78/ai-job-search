---
name: meinestadt-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German
  job listings, look up a specific posting on meinestadt.de, or asks anything about the
  German job market — even if they don't mention meinestadt.de explicitly. meinestadt.de
  is a general German local-classifieds portal with broad, nationwide job-listing coverage
  organized by city and occupation category. Invoke for open positions, vacancies, and
  hiring across any sector or role (management, IT, trades, sales, healthcare, etc.) in
  Germany. Trigger phrases: meinestadt, meinestadt.de, jobs.meinestadt.de, jobs in germany,
  german jobs, job search germany, stellenangebote, stellenanzeigen, jobsuche, jobbörse,
  offene stellen, jobs in berlin, jobs münchen, jobs hamburg, jobs frankfurt, jobs köln,
  find a job germany, vacancies germany, hiring germany, work in germany, look up this
  meinestadt job posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/meinestadt-search/cli/src/cli.ts *)
---

# meinestadt.de Search Skill

Search live job listings from **[jobs.meinestadt.de](https://jobs.meinestadt.de)**, a
general German local-classifieds portal with broad, nationwide job-listing coverage. No
authentication needed for search or job detail. **Zero runtime dependencies** — it runs
with just `bun`.

meinestadt.de's `robots.txt` does **not** disallow the paths this CLI uses (city+category
listing pages, native `premium`/`standard` detail pages, and the portal's own sitemap XML).
It does disallow two things this CLI deliberately never requests: pagination beyond page 1
(`Disallow: /*?page=`, site-wide) and the partner "apply" redirect wrapper that many
listings link through (`Disallow: /redirect/` on jobs.meinestadt.de; `Disallow: /*?*redirectUrl`
on www.meinestadt.de). No ToS-driven personal-use warning is needed here — unlike
LinkedIn/Xing, this CLI's core access pattern is robots.txt-compliant. See `url-reference.md`
for the full breakdown, including a bot-protection quirk worth knowing about (a plain `curl`
request gets blocked by Akamai; this CLI's `bun fetch` calls are not, but keep volume low
regardless — that could change without notice).

## Important: this portal has no free-text search

Unlike LinkedIn, StepStone, Indeed, or Xing, meinestadt.de has **no keyword query parameter**
that filters results (confirmed live: `?jobwrds=<query>` returns the same unfiltered listing
as no query at all). Job listings are organized by a fixed German occupation/category
taxonomy (~293 categories) crossed with a city. This CLI resolves `--query` to the closest
matching category by fetching the portal's own sitemap index and substring-matching the
query's words against each category's slug.

**Practical effect**: German job titles and category names work well (e.g.
"Geschäftsführer", "Softwareentwickler", "Vertriebsleiter", "IT-Manager"). English
abbreviations or titles with no direct German-taxonomy match (e.g. "CTO", "Director") return
**zero results with an explanatory note, not an error** — try the closest German
equivalent instead.

## When to use this skill

- Search for job openings in Germany by German job title, role, or occupation category
- Get the full description of a specific native (non-redirect) job listing
- Explore the German job market for management, tech, trades, or any other occupation,
  nationwide or in a specific city

## Commands

### Search job listings

```bash
bun run .agents/skills/meinestadt-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (German job title, role, or category).
  **Required**. Resolved to the closest matching occupation category — see above.
- `--location <city>` / `-l <city>` — a German city (e.g. `münchen`, `berlin`). Defaults to
  nationwide (`deutschland`). Must be a city meinestadt.de recognizes (a fixed list of
  ~11,000 German cities/municipalities) — free text that isn't a real city returns zero
  results rather than an error. One naming exception: the city of Bremen is slugged
  `stadt-bremen`, not `bremen` (reserved for the federal state).
- `--jobage <days>` — **not supported**, see Notes. Passing it exits 1.
- `--page <n>` — 1-indexed page. **Only page 1 is supported**, see Notes.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/meinestadt-search/cli/src/cli.ts detail <url> [--format json|plain]
```

`<url>` must be the full `"url"` field from a `search` result (e.g.
`https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203`). A bare numeric ID
is **not** enough — unlike StepStone/LinkedIn, meinestadt's detail URL embeds the
originating city. Listings flagged `isExternal: true` (partner "apply" redirect links)
cannot be fetched — `detail` refuses them with `EXTERNAL_LISTING` since following them
would violate robots.txt; only native `premium`/`standard` listings work.

## Usage examples

```bash
# CEO/executive-track roles nationwide (an English term like "CTO" has no match — see above)
bun run .agents/skills/meinestadt-search/cli/src/cli.ts search -q "Geschäftsführer" --format table

# Software developer roles in Munich
bun run .agents/skills/meinestadt-search/cli/src/cli.ts search -q "Softwareentwickler" -l münchen --format table

# Sales leadership roles in Berlin, capped to 5 results
bun run .agents/skills/meinestadt-search/cli/src/cli.ts search -q "Vertriebsleiter" -l berlin --limit 5 --format table

# IT management roles nationwide
bun run .agents/skills/meinestadt-search/cli/src/cli.ts search -q "IT-Manager" --format json

# Full details for a specific native listing
bun run .agents/skills/meinestadt-search/cli/src/cli.ts detail "https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing URLs to `detail` |
| `table` | Quick human-readable scanning (marks external/redirect listings `[external]`) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from jobs.meinestadt.de's public listing/detail pages and sitemap XML — no
  credentials required.
- **`--query` resolves to a category, not a live text search** — see "Important" above.
  `meta.matchedCategory` in JSON output shows which category was used; `meta.note` explains
  a zero-result miss.
- **`--jobage` is not supported.** The recency filter (`filter-actuality`, "letzte 24
  Stunden"/"letzte 7 Tage") is an AJAX-driven page control with no confirmed URL parameter.
- **Pagination is not supported beyond page 1.** meinestadt's `?page=N` is disallowed
  site-wide by robots.txt (`Disallow: /*?page=`, `Disallow: /*&page=`) for this CLI's honest
  User-Agent. `--page 2` and above return `PAGINATION_UNSUPPORTED`. Page 1 (20 results;
  `meta.total` carries the true total, which can run into the hundreds or low thousands for
  broad categories nationwide) is what's reachable.
- **Many listings are partner "apply" redirect links**, not native meinestadt postings —
  flagged `isExternal: true`. These are common (often a majority of results in a
  city-scoped category). `detail` only works on native `premium`/`standard` listings.
- **Two detail-page shapes**: `premium` listings embed a full schema.org `JobPosting`
  (richest data: description, employment type, posting date, deadline). `standard` listings
  have no such structured block — this CLI falls back to parsing the visible page markup for
  those, which yields title/company/location/description/date but no employment type or
  deadline (`employmentType`/`deadline` are `null`).
- **No separate apply URL** — meinestadt's apply flow is an in-page form/button, not a
  resolvable external link, on both listing tiers checked live; `applyUrl` is always `null`.
- Job IDs are plain numeric strings but are **not** unique keys across listing tiers/cities
  on their own — always pass the full URL to `detail`.
- Postings are in German.
