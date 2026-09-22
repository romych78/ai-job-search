---
name: experteer-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for executive or senior-level jobs in
  Germany, find a specific posting on Experteer, or asks about the German executive job
  market — even if they don't mention experteer.de explicitly. Experteer is Germany's
  leading job board for executives, senior specialists, and management roles (director,
  VP, C-level, Geschäftsführer). Invoke for open leadership positions, executive
  vacancies, and senior hiring across any sector. Trigger phrases: Experteer, experteer.de,
  executive jobs germany, senior jobs germany, Führungspositionen, Geschäftsführer
  stellenangebote, CTO jobs germany, Vorstand jobs, Führungskräfte jobsuche, executive
  search germany, C-level jobs germany, look up this Experteer posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/experteer-search/cli/src/cli.ts *)
---

# Experteer Search Skill

Search live job listings from **[www.experteer.de](https://www.experteer.de)**,
Germany's leading job board for executive and senior-level roles. No authentication
needed for search or job detail. **Zero runtime dependencies** — it runs with just `bun`.

Both commands are fully robots.txt-compliant for this CLI's honest, self-identifying
User-Agent (`experteer-search-cli/1.0`) — no personal-use warning needed. Experteer's
`robots.txt` disallows only `/export/`, `/*.pdf$`, `/signup_l/`, `/recr_account/`,
`/wordpress/*`, and `/monitoring`; none of those cover `/jobs` (search) or
`/career/view-jobs/*` (detail). See `url-reference.md` for the full breakdown.

## When to use this skill

- Search for executive, director, VP, or C-level openings in Germany (any sector)
- Filter by recency (a genuine server-side filter) or fold a city into the keyword query
- Get the full description, salary band, and employment details of a specific posting

## Commands

### Search job listings

```bash
bun run .agents/skills/experteer-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (job title, skill, role). Include the
  city here too — see the Location note below.
- `--jobage <days>` — posted within N days. Maps directly to Experteer's own
  `since_days` server-side parameter — a genuine filter, not client-side approximation.
- `--page <n>` — 1-indexed page (25 results/page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **Location note**: Experteer has no location URL parameter that changes the result
> set (probed `location`, `city`, `ort`, `standort`, `region`, `geocode[location]`,
> and `distance` — none altered the result count in a live test). Include the city in
> `--query` instead, e.g. `--query "CTO Berlin"` — confirmed live, this genuinely
> narrows results (the same workaround `jobindex-search` and `stepstone-search`
> document for their portals).

> **Company note**: Experteer hides the employer's name on search-result cards behind
> a "sign up to see all jobs at this company" wall — `company` is always `null` in
> `search` output. The real company name **is** available via `detail` (Experteer's
> own schema.org data exposes it there, unguarded).

### Fetch full job detail

```bash
bun run .agents/skills/experteer-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `59148463`). You may also pass a
full detail URL with any descriptive slug — Experteer resolves the canonical job from
the trailing numeric ID regardless of what precedes it. Returns the full description,
employment type, work mode, salary band, posting date, and validity deadline.

## Usage examples

```bash
# CTO / executive tech roles anywhere in Germany
bun run .agents/skills/experteer-search/cli/src/cli.ts search -q "CTO" --format table

# Geschäftsführer roles, posted in the last 30 days
bun run .agents/skills/experteer-search/cli/src/cli.ts search -q "Geschäftsführer" --jobage 30 --format table

# CTO roles in Berlin (city folded into the query — see Location note)
bun run .agents/skills/experteer-search/cli/src/cli.ts search -q "CTO Berlin" --format table

# Director-level roles, capped to 5 results
bun run .agents/skills/experteer-search/cli/src/cli.ts search -q "Director" --limit 5 --format table

# Second page of a broad query
bun run .agents/skills/experteer-search/cli/src/cli.ts search -q "Vorstand" --page 2 --format table

# Full details for a specific posting
bun run .agents/skills/experteer-search/cli/src/cli.ts detail 59148463 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Data source**: the search-results page is server-rendered HTML (Rails + AngularJS,
  stable `job-list-item-*` CSS classes). The job-detail page is served from a separate,
  newer Next.js stack and embeds a schema.org `JobPosting` block as JSON inside a
  `(self.__next_s=...).push([...])` hydration script — the CLI parses that JSON
  directly rather than scraping the detail page's hashed CSS-module class names
  (e.g. `styles-module-scss-module__PJGEYa__h3`), which shift on every deploy.
- **`--jobage` is a genuine server-side filter.** Confirmed live: `since_days=1` → 12
  results, `since_days=3` → 13, `since_days=30` → 77, unfiltered → 190 (all for the
  same "CTO" query). Unlike several other portals in this repo, no client-side date
  filtering is needed.
- **`date` in search results is a best-effort conversion.** Experteer's search cards
  show a relative German label ("Vor 7 Tagen veröffentlicht" = "published 7 days ago"),
  which the CLI converts to an approximate ISO date. Postings older than 30 days show
  an open-ended "Vor 30+ Tagen veröffentlicht" bucket with no exact day count — `date`
  is `null` for those rather than a guessed value. `detail` returns Experteer's own
  exact `datePosted` instead.
- **No separate apply URL.** Experteer's "Jetzt bewerben" button is an in-page action
  (behind the platform's own account/application flow), not a resolvable external
  link — `applyUrl` is always `null` in `detail` output. The posting's own URL is the
  entry point for a human to apply.
- **Occasional missing hydration block.** On rare fetches, the detail page's HTML
  didn't include the `__next_s` hydration script that carries the `JobPosting` JSON
  (observed once during testing, not reproduced on retry) — in that case `detail`
  returns `NOT_FOUND` even though the job exists. Retrying the request resolves it.
- Postings are predominantly German, with English used for some international
  executive-search roles.
