---
name: michaelpage-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs via Michael Page Germany,
  an executive/professional recruitment agency with its own public job board
  (michaelpage.de), or look up a specific Michael Page job posting. Invoke for
  executive, management, and specialist/professional roles across any sector in
  Germany. Trigger phrases: Michael Page, michaelpage.de, executive search Germany,
  Personalvermittlung, Personalberatung, Fach- und Führungskräfte, Stellenangebote
  Michael Page, offene Stellen, Jobsuche, "jobs on Michael Page", "find an executive
  job in Germany", look up this Michael Page job posting.
context: fork
enabled: true  # Germany-specific portal — set to false (or have /scrape skip it) if Germany isn't your market
allowed-tools: Bash(bun run .agents/skills/michaelpage-search/cli/src/cli.ts *)
---

# Michael Page Germany Search Skill

Search live job listings from **[michaelpage.de](https://www.michaelpage.de)**, Michael
Page's public job board for Germany — a global executive/professional recruitment
agency (part of PageGroup). No authentication needed for search or job detail.
**Zero runtime dependencies** — it runs with just `bun`.

No personal-use warning needed: robots.txt does **not** disallow the `/jobs` search
path (with the `search=`/`location=`/`page=` query params this CLI uses) or
`/job-detail/...` pages for a generic, honestly-identified User-Agent
(`michaelpage-search-cli/1.0`). This differs from `linkedin-search` and
`xing-search` in this repo, both of which had their search paths disallowed. See
`url-reference.md` for the full robots.txt breakdown. The one path this CLI never
fetches is `/job-apply/...` (disallowed for the generic bucket) — apply URLs are
constructed and reported, never requested.

## When to use this skill

- Search for executive, management, and specialist/professional job openings in
  Germany, posted or managed by Michael Page
- Filter by free-text location
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role).
- `--location <text>` / `-l <text>` — free-text place, e.g. `"Berlin"`, `"München"`, `"Frankfurt"`.
- `--jobage <days>` — accepted for interface compatibility, **has no effect** (see Notes —
  Michael Page has no posting-date field on search-result cards).
- `--page <n>` — page number (1-indexed, up to 30 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/michaelpage-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is `<slug>/ref/<ref>` from a `search` result (e.g.
`head-it-wdm-leipzig/ref/jn-082026-7077601`) — Michael Page's detail pages require this
exact slug+ref pair, a bare reference number alone is not a valid lookup key. You may
also pass a full `michaelpage.de/job-detail/...` URL. Returns the full description,
contract type, work mode, salary (when shown), posting date, and the constructed apply
URL.

## Usage examples

```bash
# CTO / IT-leadership roles anywhere in Germany
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search -q "CTO" --format table

# IT roles in Berlin
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search -q "IT" -l "Berlin" --format table

# Finance director roles
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search -q "Finance Director" --format table

# Geschäftsführer (managing director) roles
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search -q "Geschäftsführer" --format table

# Second page of a broad query
bun run .agents/skills/michaelpage-search/cli/src/cli.ts search -q "IT" --page 2 --format table

# Full details for a specific job
bun run .agents/skills/michaelpage-search/cli/src/cli.ts detail head-it-wdm-leipzig/ref/jn-082026-7077601 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **`company` is always `null`.** Michael Page is a retained/executive-search agency:
  the real hiring company is deliberately withheld ("unser Mandant" / "our client" in
  the job description) until later in the process. This CLI never reports "Michael
  Page" (the agency's own name — the only value the portal's data ever actually
  exposes) as the employer, since that would be a factual error in any downstream
  CV/cover-letter drafting workflow. **Do not treat Michael Page as the hiring
  company** when using this skill's output.
- **No posting-date field on search-result cards.** A `date` only exists on
  individual job-*detail* pages (schema.org `datePosted`); `--jobage` is accepted
  for interface compatibility with other portal skills but is a no-op here.
- **Search is genuinely public and complete** — no login wall. Confirmed live
  against `www.michaelpage.de/jobs?search=CTO` (redirects to the friendly
  `/jobs/cto` URL): real, full job cards (title, location, contract type, work mode,
  salary when shown, teaser text, benefit bullets) without authentication.
- **Search results get padded with recommendations on thin result sets.** A query
  with few real matches (e.g. `CTO`, 6 real results) gets padded with an "Andere
  Bewerber haben sich auch auf diese Jobs beworben" ("other applicants also applied
  to") block of unrelated recommended jobs. This CLI's tile-splitting regex
  excludes those automatically (see `url-reference.md`) — `meta.count` only reflects
  genuine search matches.
- **Search itself is semantic, not literal-keyword.** A `CTO` query returns "Head of
  IT" / "Teamleiter IT" postings, not just listings containing the literal string
  "CTO" — this is the portal's own search behavior, not a parsing gap.
- **Detail pages embed a "similar jobs" carousel** using job-tile-like markup, so
  this CLI's detail parser deliberately anchors on the primary job's unique
  `job-apply-block-container` block rather than reusing the search-tile parser, to
  avoid ever reading a carousel entry instead of the real job.
- **`--location` is a genuine server-side filter** — confirmed live: combining
  `-q "IT" -l "Berlin"` changed both the redirected URL (`/jobs/it/berlin`) and the
  result set.
- **`page` is 0-indexed on the portal's side** (`page=0` is the first page,
  `page=1` on a 6-result query 404s); this CLI's `--page` flag stays 1-indexed per
  the repo convention and translates internally.
- **Page size**: up to 30 results per page, confirmed live.
- **No application deadline** exists in Michael Page's job-detail data; `deadline`
  is always `null`.
- **Apply URL is constructed, never fetched.** `/job-apply/...` is disallowed by
  robots.txt for this CLI's honest User-Agent; `applyUrl` in `detail` output is
  built from the job's own slug/ref rather than requested.
- Postings are a mix of German and English; German dominates, with English common
  for senior/international roles.
