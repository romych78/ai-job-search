# Indeed.de URL Reference

Public, unauthenticated pages on `de.indeed.com` used by this skill.

> Personal use only. `search` page 1 is robots.txt-compliant for an honest User-Agent;
> `detail` and pagination beyond page 1 are not — see the warning in `SKILL.md`.

## robots.txt summary (checked live)

`de.indeed.com/robots.txt` defines three relevant buckets:

1. **`User-agent: *`** (generic bots — this CLI falls here, since its honest UA
   `indeed-de-search-cli/1.0` matches no named token below):
   - `Allow: /`
   - Disallows country-path search variants: `/jobs/DE/`, `/Jobs/DE/`, `/jobs/title`,
     `/jobs/<CC>/` for every other country code, etc. Does **not** disallow the bare
     `/jobs?q=...` query form — that's what this CLI uses.
   - `Disallow: /viewjob?` — the detail endpoint.
   - `Disallow: /*&start=` — classic pagination offset.
   - `Disallow: /*&serpstart=`, `/applystart`, `/pagead/`, `/rc/`, `/rpc/`, and many
     account/resume/alert paths not used by this CLI.
2. **Named real-time AI-agent bucket** (`Googlebot`, `PerplexityBot`, `Claude-User`,
   `Claude-SearchBot`, `OAI-SearchBot`, `ChatGPT-User`, `DuckAssistBot`,
   `Perplexity-User`, `Gemini-Deep-Research`, `xAI-Grok`, and similar): same country-path
   disallows as bucket 1, but **no** `Disallow: /viewjob?` and no bare `/jobs` block —
   these identities may fetch `/viewjob?jk=...` and `/jobs?q=...` freely. They **do**
   still hit `Disallow: /*&start=`, so pagination is blocked for them too.
3. **Named bulk/training-crawler bucket** (`GPTBot`, `ClaudeBot`, `CCBot`,
   `anthropic-ai`, `Bytespider`, `Baiduspider`, `AmazonBot`, and similar): the most
   restrictive — disallows bare `/jobs` and `/viewjob` outright (no `?` needed), on top
   of everything bucket 1 disallows. Training crawlers get less access than generic
   bots, not more.

This CLI's honest UA sits in bucket 1: `search` page 1 is fine, `detail` and
pagination are outside the allowance (hence the SKILL.md warning).

## Search

```
GET https://de.indeed.com/jobs
```

Confirmed live: `https://de.indeed.com/jobs?q=CTO&l=Deutschland` → HTTP 200, real
results (verified 2026-08-07).

| Param | Meaning | Example |
|-------|---------|---------|
| `q` | Free-text query | `CTO`, `data engineer` |
| `l` | Location (city, region, or `Deutschland` for nationwide) | `Berlin`, `München`, `Deutschland` |
| `fromage` | Posted-within window, in days | `1`, `7`, `14`, `30` — confirmed live, no upper-bound restriction observed |
| `start` | Pagination offset (10/page) | **Do not use** — see Pagination note below |

### Response structure

The page embeds a JSON blob inline:

```html
<script>window.mosaic.providerData["mosaic-provider-jobcards"]={...};</script>
```

Path to the array of results: `<blob>.metaData.mosaicProviderJobCardsModel.results`
(an array of ~15 objects mixing sponsored and organic listings). Relevant fields per
result:

| Field | Meaning |
|-------|---------|
| `jobkey` | 16-char hex job ID, e.g. `48ee97925d1c9ac5` |
| `displayTitle` | Job title |
| `company` | Company name (string, sometimes absent on aggregated listings) |
| `companyOverviewLink` | Relative path to the company profile, e.g. `/cmp/Elunic-Gmbh-2` |
| `formattedLocation` | Location string, e.g. `"Berlin"`, `"10829 Berlin"`, `"Deutschland"` |
| `pubDate` | Posting timestamp, epoch **milliseconds** — the CLI normalizes this to ISO `YYYY-MM-DD` for `date` |
| `formattedRelativeTime` | Indeed's own relative string, e.g. `"vor 3 Tagen"`, `"Gerade geschaltet"`, `"vor 30+ Tagen"` — passed through as `relativeDate` |
| `adId` | Present (non-null) if the listing is sponsored |
| `viewJobLink` | Relative `/viewjob?jk=...` link, but carries tracking params (`tk`, `ad`, `advn`, ...) — the CLI discards these and builds a clean canonical URL `${BASE_URL}/viewjob?jk=<jobkey>` instead |

A quoted-string-aware, brace-depth-tracking extractor is required (not a naive regex)
because the blob's `snippet`/description fields contain literal `{`/`}`-free HTML but
also nested JSON objects — a shallow regex would truncate at the first unrelated `}`.

### Pagination

`&start=10` etc. is the classic Indeed offset param. **Confirmed live**: an
unauthenticated request with `&start=10` gets a `307` redirect to
`https://secure.indeed.com/auth?...&branding=page-two-signin` — a sign-in wall, not
just a robots.txt courtesy restriction. Combined with robots.txt's
`Disallow: /*&start=` for this bucket, pagination beyond page 1 is both technically
inaccessible to anonymous requests and outside the allowed crawl surface. This CLI
returns a `PAGINATION_UNSUPPORTED` error for `--page > 1` instead of spending a request
on a page it already knows will fail.

### fromage

`&fromage=14` confirmed live: all 15 results returned had `pubDate` within the
requested window (small ~1 day variance from relative-time rounding). No separate
upper bound observed; pass through the requested day count directly.

## Detail

```
GET https://de.indeed.com/viewjob?jk=<jobkey>
```

Confirmed live: `https://de.indeed.com/viewjob?jk=e23b34b70fd69712` → HTTP 200, full
description text, no JS-rendering required — the description arrives in the initial
HTML response.

### Response structure

The detail page embeds a schema.org `JobPosting` block:

```html
<script type="application/ld+json">{"@context":"http://schema.org","@type":"JobPosting", ...}</script>
```

Fields used:

| JSON-LD field | Maps to |
|---------------|---------|
| `title` | `title` |
| `hiringOrganization.name` | `company` |
| `jobLocation.address.{addressLocality,addressRegion,addressCountry}` | `location` (joined) |
| `datePosted` (ISO datetime) | `date` (sliced to `YYYY-MM-DD`) |
| `validThrough` (ISO datetime) | `deadline` (sliced to `YYYY-MM-DD`) |
| `employmentType` (array, e.g. `["FULL_TIME"]`) | `employmentType` (joined) |
| `description` (HTML string) | `description` (tags stripped, entities decoded, paragraph breaks preserved as `\n`) |

This is far more stable than parsing the surrounding page's CSS classes (which do
exist — `jobsearch-JobInfoHeader-title`, `#jobDescriptionText`, etc. — and are kept
as a title/description fallback in `helpers.ts` in case a posting is ever missing the
JSON-LD block). The page also embeds a second `mosaic-provider-jobcards` blob, but
unlike the search page its `metaData` is empty on detail pages — the JSON-LD block is
the reliable source here, not the mosaic blob.

### Postings with no JSON-LD block at all (confirmed live, sponsored listings)

At least one class of listing — observed on a sponsored/"gesponsert" posting
(`jk=48ee97925d1c9ac5`, an ad-network job) — renders its detail page with **no**
`<script type="application/ld+json">` block whatsoever. `title` and `description`
still resolve via the CSS-class fallbacks above, but `company`/`location` needed a
second fallback: the page's minified JS bundle still contains the same data as plain
`"companyName":"...")`, `"companyOverviewLink":"...")`, and `"formattedLocation":"...")`
JSON-string literals (not inside a clean top-level blob — just literal substrings in
a bundle). `helpers.ts`'s `extractJsonStringField` targets those by key, decoding the
JS-source `\uXXXX` escapes via `JSON.parse('"' + match + '"')`.

**No fallback exists for `date`/`deadline`/`employmentType`** on these JSON-LD-less
postings — they come back `null`. The bundle does contain a `jobTypes` array with
human-readable German labels (e.g. `"Festanstellung"`, `"Vollzeit"`) but multiple
unrelated occurrences appear on the same page (e.g. a "similar jobs" rail), and
disambiguating the right one reliably wasn't worth the fragility it would add.

### Cloudflare's intermittent "Security Check" challenge page (confirmed live)

Some fraction of requests to `/viewjob?jk=...` — observed on both `curl` and this
CLI, with no automation markers involved — return an **HTTP 200** whose body is not
the job posting but a Cloudflare managed-challenge page:
`window.INDEED_CLOUDFLARE_STATIC_PAGE = {PAGE_TYPE:"captcha", ...}` and
`<title>Security Check - Indeed.com</title>`. This is a *different* failure mode from
the plain 403 noted below — same status code as success, so it's easy to miss if you
only check `response.ok`. `htmlFetch` checks the body for the
`INDEED_CLOUDFLARE_STATIC_PAGE` marker and retries with the same backoff as 429/403/5xx
rather than returning the challenge page as if it were content.

`applyUrl` is intentionally left `null`: Indeed's own apply-start and redirect-click
paths (`/applystart`, `/pagead/clk`, `/rc/...`) are both JS-driven and separately
disallowed by robots.txt, so this CLI doesn't attempt to resolve them.

## Notes

- No authentication required for search page 1 or for `detail`.
- Respect rate limits — the CLI backs off on 429/5xx with exponential backoff + jitter,
  same pattern as the other portal skills in this repo.
- **403 is treated as transient, not a hard failure.** Confirmed live: Indeed's
  Cloudflare bot-management intermittently returns 403 for `/viewjob?jk=...` requests
  that are otherwise identical to ones that just succeeded — reproduced with plain
  `curl` (no automation markers at all), alternating 403/200/403 across three
  back-to-back requests to the same URL. This CLI's `htmlFetch` retries on 403 with the
  same exponential backoff used for 429/5xx, and that reliably recovers within a few
  attempts in practice.
- Job keys are 16-character hex strings; the CLI also accepts a full `/viewjob?jk=...`
  URL or any URL containing a `jk=` parameter for `detail`.
- Verified live 2026-08-07 with User-Agent `Mozilla/5.0 (compatible; indeed-de-search-cli/1.0)`.
