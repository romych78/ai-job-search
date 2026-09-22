# Xing Jobs URL Reference

Public, unauthenticated job-search and job-detail pages used by this skill.

> Personal use only — see SKILL.md's robots.txt note. Keep volume low.

## Search

```
GET https://www.xing.com/jobs/search?<params>
```

301-redirects to `https://www.xing.com/jobs/search/ki?<params>` (follow the redirect; the
CLI's `fetch` does this automatically). Both the original and redirected path are
`Disallow`'d in `robots.txt` for the generic `User-agent: *` bucket — only Xing's named
AI-crawler allowlist (`GPTBot`, `ClaudeBot`, `PerplexityBot`, etc.) gets an explicit
`Allow`. This CLI does not impersonate those crawlers.

Query params (confirmed live against a "CTO" query):

| Param | Meaning | Example | Confirmed how |
|-------|---------|---------|----------------|
| `keywords` | Free-text query | `CTO` | Baseline test query |
| `location` | Free-text place (city/region) | `Berlin` | Changed the GraphQL query body (`query.location.text`) and result count (20 → 17) |
| `page` | 1-indexed page | `2` | Changed the GraphQL cache key's `offset` from `0` to `20` |

Params that do **not** work (probed and confirmed inert):
- `age=<n>` (or similar posted-within param) — the GraphQL query body (`query.keywords`,
  no `filterCollection`) was unchanged with or without it. Xing's "Veröffentlicht"
  (24h/week/month) filter is a JS-only UI control with no discoverable URL parameter.

### Response structure

The HTML response is a normal server-rendered page (no SPA shell with an empty body) that
embeds a full GraphQL/Apollo cache as JSON:

```html
<script id="runtime-config">window.crate={ ... }</script>
```

The value assigned to `window.crate` is a JS object literal (not strict JSON — it can
contain bare `undefined`, e.g. `"activeThemeCookie":undefined`; the CLI replaces
`:undefined` with `:null` before `JSON.parse`). Path to the results:

```
crate.serverData.APOLLO_STATE.ROOT_QUERY["jobSearchByQuery({...})"].collection
```

- The key name embeds the serialized query arguments (`consumer`, `flags`, `limit`,
  `offset`, `query`, `returnAggregations`, `searchMode`, `trackRecent`), so it changes
  between requests — find it by `Object.keys(ROOT_QUERY).find(k =>
  k.startsWith("jobSearchByQuery("))` rather than reconstructing the exact string.
- `.total` is always `-1` in `searchMode: "SEMANTIC"` — there is no portal-wide result
  count available this way.
- `.collection` is an array of `{ jobDetail: { __ref: "VisibleJob:<id>.<hash>" } }`
  pointers into the flat Apollo cache. Fixed at 20 items (`limit: 20`) per page.

Each `VisibleJob:<id>.<hash>` cache entry (referenced from the collection) has:

| Field | Notes |
|-------|-------|
| `slug` | e.g. `hamburg-cto-154939702` — use this as the CLI's `id` |
| `title` | Plain string, already JSON-decoded (no HTML entities to strip) |
| `url` | Full canonical `https://www.xing.com/jobs/<slug>` |
| `refreshedAt` | ISO timestamp — used as the CLI's `date` field (see caveat below) |
| `location.city` | City name |
| `employmentType` | Either an inline `{ localizationValue }` or a `{ __ref: "EmploymentType:..." }` pointer to resolve |
| `companyInfo.companyNameOverride` | Company display name (can be the literal string `"confidential"`) |
| `companyInfo.company.__ref` | If present (not always — can be `null`), points to a `Company:<id>` entry with a `companyName` field |
| `salary.{minimum,maximum,currency}` | Present when Xing shows an estimated salary band |
| `application.applyUrl` | Present on both search-page and detail-page cache entries |
| `description.content` | **Only reliably present on the detail page's cache entry** — full HTML job description |
| `activeUntil` | ISO timestamp — posting deadline / expiry |

**No true "date posted" field exists** — `refreshedAt` is the closest proxy (it's what
Xing's own UI displays as "Vor N Stunden veröffentlicht" / "posted N hours ago"; confirmed
by comparing the two directly on a live job).

## Detail

```
GET https://www.xing.com/jobs/<slug>
```

Where `<slug>` is the value from a search result's `id` (or extracted from its `url`).
**Not** covered by the `/jobs/search/` robots.txt disallow rule.

- **Requires the exact slug.** A bare numeric ID (e.g. `/jobs/154939702`) is *not* treated
  as a lookup — Xing interprets it as a search keyword instead (confirmed: the page title
  became `"Aktuelle 154939702 Jobs - ..."`, i.e. a search-results page). A
  right-shaped-but-wrong slug (e.g. swapping the descriptive prefix but keeping the real
  trailing ID) returns **HTTP 410 Gone**, not a redirect to the canonical slug (confirmed
  live). Treat both 404 and 410 as "not found."
- The detail page embeds the same `window.crate` JSON blob as search, but with the primary
  job's full record (including `description.content`) plus several "similar jobs" sidebar
  entries as additional `VisibleJob:*` cache entries — **filter by `slug` to find the
  right one**, don't just grab the first `VisibleJob:` key.
- The page also carries a `<script type="application/ld+json">` schema.org `JobPosting`
  block (title, description, datePosted, validThrough, employmentType, hiringOrganization,
  jobLocation) as an alternative source, but it lacks `applyUrl` and `salary`, which only
  live in the Apollo cache — this CLI uses the Apollo cache for both search and detail so
  there's one extraction code path.
- The description HTML uses uppercase tags (`<DIV>`, `<P>`, `<LI>`, `<STRONG>`, `<H1>`,
  `<H3>`) — the CLI's tag-stripping regex is case-insensitive so this doesn't matter, but
  it's a notable quirk if you're eyeballing raw output.

## robots.txt (fetched live)

```
User-agent: *
...
Disallow: /jobs/search/
Disallow: /jobs/search?*
...

User-agent: GPTBot
User-agent: GPTUser
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
Allow: /jobs/search/
Allow: /jobs/search?*
...
```

`/jobs/<slug>` (the detail path) is not mentioned in either bucket's disallow list.
`/xing-one/api` and `/graphql/` are `Disallow`'d for everyone (and likely require auth
regardless) — not pursued.

## Notes

- No authentication required for either search or detail.
- Honest User-Agent: `Mozilla/5.0 (compatible; xing-search-cli/1.0)` — does not claim to
  be any of Xing's named-crawler allowlist entries.
- The CLI backs off on 429/5xx with jittered exponential backoff (max 6 retries); treats
  404 and 410 as "not found" rather than an error.
- Country-specific to the DACH region — postings are a mix of German and English.
