# meinestadt-cli

CLI for searching jobs on **[jobs.meinestadt.de](https://jobs.meinestadt.de)**, a general
German local-classifieds/jobs portal with broad, nationwide job-listing coverage.

**Data source**: jobs.meinestadt.de's public listing pages (`/<city>/{jk,jkl}/<code>`), job
detail pages (`/<city>/{premium,standard}?id=<id>`), and the portal's own sitemap XML
(`/sitemaps/jobs-jk-index.xml` and per-category sitemaps) used to resolve `--query` — see
Notes below.
**Authentication**: None required for search, detail, or the sitemap lookups.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

## Installation

```bash
cd .agents/skills/meinestadt-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by category (see Notes — no free-text search exists) |
| `detail` | Fetch full detail for a single native (non-redirect) job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Management/CEO-track roles nationwide (an English term like "CTO" has no match — see Notes)
bun run src/cli.ts search -q "Geschäftsführer" --format table

# Software developer roles in Munich
bun run src/cli.ts search -q "Softwareentwickler" -l münchen --format table

# Full detail for one native listing (use the "url" field from a search result)
bun run src/cli.ts detail "https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203" --format plain
```

See `../SKILL.md` for the full flag reference and quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keywords. **Required** — resolved to the closest matching category in meinestadt's own occupation taxonomy (see Notes). |
| `--location` | `-l` | German city (e.g. `münchen`). Defaults to nationwide (`deutschland`). |
| `--jobage` | | **Not supported.** Passing it exits 1 with `JOBAGE_UNSUPPORTED`. |
| `--page` | | 1-indexed page. **Only page 1 is supported** — see Notes. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- **No free-text search parameter exists.** Confirmed live: `?jobwrds=<query>` returns the
  same unfiltered listing as no query at all (and robots.txt disallows that parameter
  anyway). `--query` is instead resolved to the closest matching entry in the portal's own
  ~293-category occupation taxonomy (fetched from `/sitemaps/jobs-jk-index.xml`, matched by
  substring on each query word after German-umlaut transliteration). English terms like
  "CTO" or "Director" typically have no match and return zero results (not an error) with an
  explanatory `meta.note`; try a German job title or category name instead (e.g.
  "Geschäftsführer", "Softwareentwickler", "Vertriebsleiter").
- **`--jobage` is not supported.** The recency filter is an AJAX-driven checkbox in the
  page's own UI with no confirmed GET parameter.
- **Pagination**: `--page` 2 or higher returns `PAGINATION_UNSUPPORTED` — meinestadt's
  `?page=N` parameter is disallowed site-wide by robots.txt (`Disallow: /*?page=`,
  `Disallow: /*&page=`) for this CLI's honest User-Agent. Page 1 (20 results per category;
  `meta.total` carries the true total) is what's reachable.
- **Many results are partner "apply" redirect links**, not native meinestadt listings —
  flagged `isExternal: true` in output. robots.txt disallows fetching those
  (`Disallow: /redirect/` on jobs.meinestadt.de; `Disallow: /*?*redirectUrl` on
  www.meinestadt.de, where the wrapper resolves), so `detail` refuses them with
  `EXTERNAL_LISTING` — pass a native `premium`/`standard` listing's URL instead.
- **`detail` requires the full URL from a search result, not a bare ID** — unlike
  StepStone/LinkedIn, meinestadt's detail URL embeds the city (`/<city>/{premium,standard}?id=<id>`),
  so a bare numeric ID can't be resolved on its own.
- **Bot protection quirk**: a plain `curl` request (any User-Agent) to this portal gets a
  `403` from Akamai, but this CLI's `bun fetch` calls succeed — see `../url-reference.md`.
  Keep volume low regardless; this could change without notice.
