# StepStone.de URL Reference

Public, unauthenticated pages on `www.stepstone.de` used by this skill.

## robots.txt summary (checked live, `www.stepstone.de/robots.txt`)

The generic `User-agent: *` bucket — the one this CLI's honest UA
(`stepstone-search-cli/1.0`) falls into, since it matches no named token in the
file — carries two rules that determine everything this skill can and can't do:

```
Disallow: /jobs/*?*
Allow: /jobs/*?q=*
Disallow: /jobs/*?q*&*
```

Read together:

1. Any query string under `/jobs/` is disallowed by default.
2. **Exception**: a query string that is exactly `?q=<value>` is allowed.
3. **But**: a query string that starts with `q` and is followed by a second
   parameter (`&...`) is disallowed again — this overrides rule 2 for anything
   with more than one parameter.

Net effect: **`/jobs/<slug>?q=<query>` — and only that shape — is robots.txt-compliant.**
No second parameter (recency, page, location, sort, `&ag=`, `&page=`, etc.) can be
added without violating one of these rules. This CLI's `buildSearchUrl()` enforces
exactly that shape and nothing else.

No other rule in the file touches `/stellenangebote--...-inline.html` (the detail
path) — it isn't `/jobs/`, `/5/`, `/offers/`, or any other disallowed prefix — so
`detail` is unrestricted for this bucket.

## Search

```
GET https://www.stepstone.de/jobs/<slug>?q=<query>
```

Confirmed live 2026-08-07: `https://www.stepstone.de/jobs/cto?q=CTO` → HTTP 200,
page titled "CTO Jobs und Stellenangebote - 2026", 324 total results.

### The `<slug>`

Cosmetic, not load-bearing for search correctness — confirmed live: `/jobs/cto`
(no `q` at all) and `/jobs/completely-wrong-slug?q=Data%20Engineer` both return the
same effective result set as a "correct" slug+query pair. This CLI still generates
a sensible slug from the query (`slugify()` in `helpers.ts`: lowercase, spaces/
punctuation → hyphens, German umlauts/`ß` preserved) so the URL reads the way a
browser-driven search would, rather than relying on the tolerance.

| Query | Generated slug |
|-------|-----------------|
| `CTO` | `cto` |
| `data engineer` | `data-engineer` |
| `Projektmanager München` | `projektmanager-münchen` |
| `devops engineer` | `devops-engineer` |

### Response structure

The page embeds StepStone's own SSR hydration state as strict JSON:

```html
<script>
window.__PRELOADED_STATE__["app-unifiedResultlist"] = {...};
</script>
```

Path to the results: `<blob>.searchResults.items` (array, ~25 entries per page).
Total count: `<blob>.searchResults.meta.total`.

Relevant fields per item:

| Field | Meaning |
|-------|---------|
| `id` | Numeric job ID, e.g. `14030156` — the same ID `detail` accepts |
| `title` | Job title |
| `companyName` | Company name |
| `companyUrl` | Company profile page on StepStone |
| `location` | Free-text location, e.g. `"Frankfurt am Main, Berlin, Hamburg"` — StepStone allows multi-city postings |
| `datePosted` | ISO datetime with offset, e.g. `"2026-08-03T00:19:44+02:00"` — the CLI slices this to `YYYY-MM-DD` for `date` |
| `url` | Relative detail-page path, e.g. `/stellenangebote--Field-CTO-...-14030156-inline.html?rltr=1_1_25_seorl_m_0_0_0_0_1_0` — the CLI strips the `?rltr=...` tracking query before prepending the base URL |
| `textSnippet` | Plain-text preview of the description shown on the results card (not HTML-escaped in practice, but the CLI runs it through the same entity decoder as everything else, defensively) |
| `workFromHome` | Numeric flag for hybrid/remote — not currently surfaced in the CLI's output |

A quoted-string-aware, brace-depth-tracking extractor (`extractResultlistState` in
`helpers.ts`) is required rather than a naive regex, because this blob is large
(1MB+ on a typical page) and its `textSnippet`/other text fields can contain
characters a shallow regex would mis-handle.

### Pagination

`searchResults.unifiedPagination.links.next` in the same blob points to
`/jobs/<slug>?page=2` (no `q=`), and the (separate) `searchResults.pagination.links.next`
points to `/jobs/<slug>?q=<query>&of=25&action=paging_next`. **Neither is
robots.txt-compliant for this CLI's bucket**:

- `?page=2` alone has no `q=` param, so it's caught by the base `Disallow: /jobs/*?*`
  with no matching `Allow`.
- `?q=<query>&of=25...` starts with `q=` (which would normally be allowed) but is
  immediately overridden by `Disallow: /jobs/*?q*&*` because it carries a second
  parameter.

Confirmed live: `/jobs/cto` (no `q`) and `/jobs/cto?q=CTO` return effectively the
same result set (total counts differed by 1 between the two live fetches — normal
index drift between requests, not a signal that dropping `q` changes anything
meaningfully). This CLI's `search` command returns a `PAGINATION_UNSUPPORTED`
error for `--page > 1` rather than spend a request on a URL shape that's outside
the allowed pattern. Page 1 (~25 results, `searchResults.meta.total` for the true
count) is what's reachable.

### Recency filter (`--jobage`)

The same blob's `searchResults.filters` array documents an `age` facet with links
like `?ag=age_1` (posted within 24h) and `?ag=age_7` (posted within 7 days) — both
bare parameters with no `q=`, so combining either with `q` hits the same
`Disallow: /jobs/*?q*&*` rule, and using either alone hits the base
`Disallow: /jobs/*?*`. Not reachable within the allowed pattern either way. This
CLI returns `JOBAGE_UNSUPPORTED` if `--jobage` is passed at all.

### Location

No location parameter exists that's compatible with the one allowed shape (any
additional parameter is disallowed, per above). Same workaround as
`jobindex-search`: put the city in `--query`, e.g. `-q "data engineer münchen"`
— confirmed live, this changes the result set (total dropped from ~1151 to ~1 for
an unrelated city) so it's a real filter, just applied query-side rather than via
a URL parameter.

## Detail

```
GET https://www.stepstone.de/stellenangebote--<any-descriptive-slug>--<id>-inline.html
```

Confirmed live: only the trailing `--<id>-inline.html` is load-bearing — StepStone
resolves the same job whether the descriptive slug is the real title/company/
location string or a deliberately wrong placeholder (tested with `--x--14030156-inline.html`).
This CLI's `detail` command exploits that and builds
`/stellenangebote--job--<id>-inline.html` directly from a bare ID, rather than
depending on a caller-supplied slug.

### Response structure

The detail page embeds a *different* shaped blob than the search page — a JS
object literal, not strict JSON, because its outer keys are unquoted:

```html
<script>
window.__PRELOADED_STATE__.JobAdContent = {
        props: {...},   // <- this value IS strict JSON
        ...
      };
</script>
```

`extractJobAdProps` in `helpers.ts` locates the `JobAdContent = ` marker, then
looks for the *next* `props: ` after that point specifically — several other
`__PRELOADED_STATE__` blocks on the same page (`header`, `modal`,
`google-onetap`, `footer`, ...) follow the identical `{props: {...}, ...}` shape,
so an unscoped search for `"props: "` would risk matching the wrong block.
Scoping the search to start after the `JobAdContent` marker's index is sufficient
because it's the very next occurrence in document order.

Fields used from the `props` object:

| Path | Maps to |
|------|---------|
| `listingHeader.listingData.title` (fallback: `jobAdTitle`) | `title` |
| `listingHeader.listingData.companyData.name` (fallback: `companyCard.name`) | `company` |
| `listingHeader.listingData.companyData.companyNameResultPageUrl` | `companyUrl` |
| `listingHeader.listingData.metaData.location` (fallback: `jobAdLocation`) | `location` |
| `listingHeader.listingData.metaData.onlineDate` (ISO datetime) | `date` (sliced to `YYYY-MM-DD`) |
| `listingHeader.listingData.metaData.contractType` (e.g. `"Feste Anstellung"`) | `contractType` and `employmentType` (alias) |
| `listingHeader.listingData.metaData.workType` (e.g. `"Homeoffice möglich, Vollzeit"`) | `workType` |
| `textSections` (array of `{title, content}`, `content` is an HTML fragment) | `description` — sections joined with their heading text preserved, HTML stripped, entities decoded, paragraph breaks kept as `\n` |

**No application deadline field exists anywhere in this blob** (unlike, say,
Danish public-sector postings) — `deadline` is always `null`.

**No separate apply URL exists either.** StepStone's apply flow
(`applyNowSection` / the "Ich bin interessiert" button) is an in-page action tied
to a `listingId`, not a redirect to an external or StepStone-hosted form URL —
checked on both an in-house ("Schnelle Bewerbung"/quick-apply) posting and an
agency-recruited one, neither exposed a resolvable apply link in the JSON.
`applyUrl` is always `null`; the detail page's own `url` is the entry point for a
human to apply.

## Notes

- No authentication required for `search` (page 1) or `detail`.
- Respect rate limits — the CLI backs off on 429/5xx with exponential backoff +
  jitter, same pattern as the other portal skills in this repo.
- Job IDs are plain numeric strings (e.g. `14030156`); `detail` also accepts a
  full detail URL (any slug) or any string containing the `--<id>-inline.html`
  suffix.
- Verified live 2026-08-07 with User-Agent `Mozilla/5.0 (compatible; stepstone-search-cli/1.0)`.
