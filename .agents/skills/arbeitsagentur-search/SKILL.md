---
name: arbeitsagentur-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German
  job listings on the official federal job board, or look up a specific posting on
  the Bundesagentur für Arbeit Jobbörse — even if they don't mention arbeitsagentur.de
  or jobboerse.arbeitsagentur.de explicitly. Invoke for open positions, vacancies,
  and hiring across any sector or role (software, data, engineering, executive/CTO,
  public sector, finance, sales, etc.) in Germany, including postings from large
  employers and government/public-sector bodies that mainly list here. Trigger
  phrases: bundesagentur für arbeit, arbeitsagentur, jobboerse, jobbörse, jobs in
  germany, german jobs, job search germany, stellenangebote, stellenanzeigen,
  jobsuche, offene stellen, jobs in berlin, jobs münchen, jobs hamburg, jobs
  frankfurt, jobs köln, find a job germany, vacancies germany, hiring germany, work
  in germany, official german job board, public sector jobs germany, look up this
  arbeitsagentur posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts *)
---

# Bundesagentur für Arbeit (Jobbörse) Search Skill

Search live job listings from **[jobboerse.arbeitsagentur.de](https://jobboerse.arbeitsagentur.de)**,
Germany's official federal employment agency job board — the broadest single source
for the German market, including public-sector, government, and large-employer
postings that don't always appear on commercial boards. This talks directly to BA's
public **JSON API** (the same one their own web/mobile app uses), not HTML scraping.
No login required. **Zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

No login is required for anything this skill does, and `robots.txt` on both
`jobboerse.arbeitsagentur.de` (absent) and `www.arbeitsagentur.de` (fully permissive)
is not a blocker. However, per a 2021 FragDenStaat freedom-of-information response,
the Bundesagentur has stated on the record that this API **"is not designed for mass
evaluation using technical means,"** and it added anti-automation/CAPTCHA protection
around parts of the job-search flow specifically to stop bulk crawling of employer
contact details. This skill never requests employer contact info (no phone/email
endpoint is used, and none appeared in any response during testing), and hit no
CAPTCHA challenges for search or job-description reads — but out of respect for BA's
stated intent, **keep volume low, don't use this commercially or for bulk data
collection, and run it on your own responsibility.**

## When to use this skill

- Search for job openings anywhere in Germany by keyword, job title, or role
- Narrow to a German city, region, or state via `--location`
- Filter by recency (posted within the last N days, up to 100)
- Get the full description of a specific job listing, including salary range,
  contract type, and home-office availability where the employer specified them

## Commands

### Search job listings

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (job title, skill, role).
- `--location <text>` / `-l <text>` — a German place string, e.g. `"Berlin"`,
  `"München"`, `"Bayern"`. Omit for nationwide.
- `--jobage <days>` — posted within N days, `0`-`100` (the API's documented cap;
  higher values are rejected, not silently clamped).
- `--page <n>` — 1-indexed page.
- `--limit <n>` / `-n <n>` — cap total results emitted (also sizes the underlying
  API request, capped at 100 to keep volume low).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `referenznummer` from `search` results (e.g. `12288-4929301364-S`; the
format varies by source system, treat it as opaque). You may also pass a full
`arbeitsagentur.de/jobsuche/jobdetail/...` URL. Returns the full description, salary
range (when the employer disclosed one), contract type, full-time/part-time, and
home-office availability.

## Usage examples

```bash
# CTO / executive roles nationwide
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "CTO" --format table

# Director of Engineering roles, remote-friendly search by keyword
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Director of Engineering" --format table

# Software developer roles in Munich, posted this week
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Softwareentwickler" -l "München" --jobage 7 --format table

# Geschäftsführer (managing director) roles nationwide, last 30 days
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Geschäftsführer" --jobage 30 --limit 10 --format table

# Any role in Hamburg
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -l "Hamburg" --limit 10 --format table

# Full details for a specific job
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail 12288-4929301364-S --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from BA's public Jobsuche JSON API (`rest.arbeitsagentur.de/jobboerse/jobsuche-service`)
  — the same API that powers the official jobboerse.arbeitsagentur.de web app. No
  credentials are required from the user; the API's fixed `X-API-Key` header is a
  public, non-secret client ID hardcoded into BA's own frontend, not a personal
  credential — see `url-reference.md` for the full explanation.
- **Broadest German-market coverage**: this board aggregates postings directly from
  employers (including public-sector/government bodies that mainly post here rather
  than on commercial boards) and from partner/EURES-linked sources — a nationwide
  keyword search can surface a small number of cross-border (e.g. Austrian) postings
  too; that's the platform's own behavior, not a bug.
- Executive-level titles (`CTO`, `Geschäftsführer`, `Director`, `Leiter Entwicklung`)
  all return results in the hundreds to low thousands nationwide — this board is not
  short on senior-leadership postings, unlike some purely SME-focused boards.
- Job descriptions come back as plain text with inconsistent formatting between
  postings (some structured with real paragraph breaks, others hard-wrapped with no
  paragraph structure) because it depends on how each employer submitted the
  listing — see `url-reference.md` for details. The CLI preserves the source's own
  line breaks rather than guessing at structure it doesn't provide.
- Salary (`gehaltsspanneVon`/`gehaltsspanneBis`) and detailed employment terms are
  frequently left blank by employers — `null` in that case, never fabricated.
- `referenznummer` formats vary widely by the employer's submission channel; always
  treat it as an opaque ID, never parse its internal structure.
