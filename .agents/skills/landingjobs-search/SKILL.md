---
name: landingjobs-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs on landing.jobs, a European
  tech-jobs board with strong startup/scale-up coverage (particularly Portugal-based and
  remote-friendly roles), or look up a specific landing.jobs job posting. Invoke for open
  positions, vacancies, and hiring across engineering/tech roles — individual-contributor
  software engineering roles especially (backend, frontend, full-stack, data, DevOps, AI).
  Trigger phrases: landing.jobs, Landing Jobs, search landing.jobs, jobs on landing.jobs,
  find a job on landing.jobs, look up this landing.jobs posting, Portugal tech jobs, empregos
  em tecnologia, vagas de emprego.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/landingjobs-search/cli/src/cli.ts *)
---

# landing.jobs Search Skill

Search live job listings from **landing.jobs**, a European tech-jobs board with strong
startup/scale-up coverage — mostly Portugal-based and remote-friendly roles. No
authentication, no API key, and **zero runtime dependencies** — it runs with just `bun`.

This skill is fully `robots.txt`-compliant: no personal-use warning is required. See
"How search works" below.

## When to use this skill

- Search for individual-contributor tech job openings (software engineering, data,
  DevOps, AI/ML) — mostly Portugal and EU remote-friendly roles
- Filter by free-text location or recency
- Get the full description of a specific job listing

## How search works (read this before relying on results)

landing.jobs's own keyword-search endpoint (`/jobs/search`, `/jobs/search.json`) is
**`Disallow`'d in `robots.txt`** for every user-agent — this skill never calls it. Its
per-skill "tag" pages (`/jobs/for/<skill>`) are allowed, but were confirmed live to
silently fall back to an unrelated generic job listing when the tag isn't in the site's
fixed skill taxonomy (e.g. `/jobs/for/vp-engineering` returned 50 unrelated jobs, not zero
or an error) — not a safe basis for free-text search.

Instead, this CLI treats `sitemap.xml` — which `robots.txt` itself points crawlers at via
a `Sitemap:` directive — as the public job index. Every live posting is listed there as
`/at/<company-slug>/<job-slug>`, and neither that path nor `sitemap.xml` is `Disallow`'d.
`search` filters that index by keyword against the company+job slug (whole-word match,
all query words must match), then fetches each matching posting's detail page (also not
`Disallow`'d) to get the real title/company/location/date/description.

**Practical effect**: search quality depends on the query term appearing in the URL
slug (which is usually the job title in kebab-case), not full-text across the whole
posting. A query like `"python"` or `"java developer"` matches reliably since job titles
are almost always in the slug. This board also currently skews toward
individual-contributor engineering roles rather than executive/leadership titles — a live
check found **zero** postings matching "CTO", "VP Engineering", or "Engineering Manager"
at the time this skill was built (see `url-reference.md`), which is a genuine empty
result, not a broken query.

## Commands

### Search job listings

```bash
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search, matched (whole-word, AND across
  words) against each posting's company+job URL slug.
- `--location <text>` / `-l <text>` — free-text place, e.g. `"Lisbon"`, `"Porto"`,
  `"Portugal"`, `"Remote"`. Checked against the posting's resolved location **after**
  it's fetched (there's no server-side location parameter this skill can reach).
- `--jobage <days>` — posted within N days, checked against each fetched posting's real
  creation date (**not** the sitemap's `<lastmod>` — see Notes, that field doesn't track
  the posting date).
- `--page <n>` — page number (1-indexed, 10 results per page by default).
- `--limit <n>` / `-n <n>` — cap total results emitted (also sets the page size).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/landingjobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is `<company-slug>/<job-slug>` from a `search` result (e.g.
`we-are-meta/staff-python-engineer`). You may also pass a full `landing.jobs/at/...` URL.
Returns the full description, employment type, category, experience level, and remote
policy.

## Usage examples

```bash
# Python engineering roles
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search -q "python" --format table

# Java developer roles in Lisbon
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search -q "java developer" -l "Lisbon" --format table

# Software engineer roles, second page
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search -q "software engineer" --page 2 --format table

# Roles posted in the last 14 days
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search -q "data engineer" --jobage 14 --format table

# Browse latest postings with no keyword filter
bun run .agents/skills/landingjobs-search/cli/src/cli.ts search --limit 10 --format table

# Full details for a specific job
bun run .agents/skills/landingjobs-search/cli/src/cli.ts detail we-are-meta/staff-python-engineer --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Data source for detail pages**: every job-detail page embeds a React-on-Rails
  `jobPage/JobPage` component's props as an HTML-attribute-encoded JSON blob
  (`data-react-props="{...}"`), parsed directly rather than the visible
  `lj-job-summary__*` markup — it carries structured fields (`created_at`,
  `office_locations`, `company_name`) more reliably than the rendered HTML.
- **Descriptions are double-HTML-escaped.** The `role_description` field is HTML that
  was itself entity-escaped a second time before being embedded (e.g. a literal
  `<!--block-->` marker round-trips as `&lt;!--block--&gt;`). The CLI decodes entities
  *before* converting break-tags to newlines and stripping remaining tags — decoding
  after stripping (the usual order for singly-escaped HTML) would leave the decoded
  markers behind as visible garbage.
- **No employer apply URL is exposed in public job data** — landing.jobs handles
  applications on-site through a candidate profile system, not an external redirect, so
  `detail`'s `applyUrl` is always `null`; the posting URL itself is where a candidate
  applies.
- **`--jobage` uses each posting's real `created_at`, fetched per-result** — the
  sitemap's `<lastmod>` was tested and rejected as a pre-filter: a live check found a job
  posted in February 2025 still carrying a `<lastmod>` from within the last few days,
  meaning it tracks incidental site-side updates, not the original posting date. Using it
  as a filter would have silently hidden genuinely recent postings and shown genuinely
  stale ones.
- **`--query` matching is whole-word, not substring.** An earlier version matched "cto"
  as a substring and returned `director-security-engineer-devsecops` (the string "cto"
  hides inside "dire**cto**r") — a confirmed false positive. Matching now requires a
  `\b`-bounded word match per query token.
- **Small, niche corpus.** At the time this skill was built, the site's sitemap listed
  only ~66 live `/at/<company>/<job>` postings (plus company-profile and predefined
  skill/location landing pages, which are filtered out) — mostly Portugal-based or
  Portugal-eligible-remote individual-contributor engineering roles. Executive/leadership
  titles (CTO, VP Engineering, Engineering Manager) had zero live matches when tested.
- **Fetch volume is capped.** Each `search` call fetches detail pages only for postings
  whose slug matches the query, up to an internal cap of 30 live fetches per call — a
  broad `--location` filter (checked post-fetch) can narrow the returned count below
  `--limit` without a full re-fetch of the corpus.
- The CLI backs off on 429/5xx with jittered exponential backoff (max 6 retries); treats
  404 as "not found" rather than an error.
- Honest User-Agent: `Mozilla/5.0 (compatible; landingjobs-search-cli/1.0)`.
