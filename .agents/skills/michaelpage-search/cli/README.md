# michaelpage-cli

CLI for searching jobs on **Michael Page Germany** ([michaelpage.de](https://www.michaelpage.de)),
an executive/professional recruitment agency's public job board.

**Data source**: Michael Page's server-rendered Drupal job-search page (`/jobs`) for search
results, and its `job-apply-block-container` block plus a schema.org `application/ld+json`
`JobPosting` script for job detail — parsed with regex, not a full DOM parser.
**Authentication**: None required for search or job detail.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

No personal-use warning needed: robots.txt does not disallow `/jobs` (with the
`search=`/`location=`/`page=` query params this CLI uses) or `/job-detail/...` pages for a
generic, honestly-identified User-Agent. See `../SKILL.md` and `../url-reference.md` for the
full robots.txt breakdown.

## Installation

```bash
cd .agents/skills/michaelpage-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# CTO / IT-leadership roles anywhere in Germany
bun run src/cli.ts search -q "CTO" --format table

# IT roles in Berlin
bun run src/cli.ts search -q "IT" -l "Berlin" --format table

# Full detail for one job (id/url comes from a search result)
bun run src/cli.ts detail head-it-wdm-leipzig/ref/jn-082026-7077601 --format plain
```

See `../SKILL.md` for the full flag reference.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | Free-text place (city or region), e.g. `"Berlin"`, `"München"`. |
| `--jobage` | | Accepted for interface compatibility, **has no effect** — no posting-date field exists on search-result cards. |
| `--page` | | 1-indexed page (up to 30 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## `id` is `<slug>/ref/<ref>`, not a bare reference number

Michael Page's job-detail URLs are a Drupal alias of the exact shape `/job-detail/<slug>/ref/<ref>`
— a bare `<ref>` alone, a bare `<slug>` alone, or a mismatched slug/ref pair all 404 (no fuzzy
redirect to the canonical URL). So `search` results carry the full `<slug>/ref/<ref>` pair as
`id`; pass that (or the full `url`) straight to `detail`.

## `company` is always `null`

Michael Page is a retained/executive-search agency: the real hiring company is deliberately
withheld ("unser Mandant" / "our client" in the description text) until later in the process.
This CLI reports `company: null` rather than "Michael Page" (the agency's own name, the only
value the portal's own data ever exposes) — treating the agency as the employer would be a
factual error in any downstream CV/cover-letter workflow.
