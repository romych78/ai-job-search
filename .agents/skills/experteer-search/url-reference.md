# Experteer.de URL Reference

Public, unauthenticated job-search and job-detail pages on `www.experteer.de` used by
this skill.

## robots.txt (fetched live, `https://www.experteer.de/robots.txt`)

```
User-agent: *
Disallow: /export/
Disallow: /*.pdf$
Disallow: /signup_l/
Disallow: /recr_account/
Disallow: /wordpress/wp-admin/
Disallow: /wordpress/wp-login/
Disallow: /wordpress/wp-login.php
Disallow: /wordpress/wp-content/cache/
Disallow: /monitoring
```

(Plus per-bot `Crawl-delay` entries for named crawlers like `bingbot`, `SemrushBot`,
`PerplexityBot`, `Claude-SearchBot`, `AhrefsBot`, `CCBot` — none of which apply to this
CLI's honest, unnamed User-Agent, which falls into the generic `User-agent: *` bucket.)

Neither `/jobs` (search) nor `/career/view-jobs/*` (detail) is disallowed for the
generic bucket. **No personal-use warning is required** — this portal is fully
reachable within its own stated policy, the same situation as `stepstone-search`.

## Search

```
GET https://www.experteer.de/jobs?<params>
```

Confirmed live 2026-09-04 against `text=CTO`: HTTP 200, `<h1 class="result-hits">190
Jobs für 'cto'</h1>`, 25 real job cards per page.

### Query parameters

| Param | Meaning | Confirmed how |
|-------|---------|----------------|
| `text` | Free-text keyword query | **The correct param name** — `keywords`, `q`, and `search` were all probed and left the result count unchanged (still the full ~65k unfiltered set); `text=CTO` dropped it to 190. Found via the AngularJS form's `ng-model="searchCtrl.criteria.text"`. |
| `since_days` | Posted within N days — genuine server-side filter | `since_days=1` → 12 results, `since_days=3` → 13, `since_days=30` → 77, omitted → 190 (same `text=CTO` query each time) |
| `page` | 1-indexed page, 25 results/page | `page=2` returned a disjoint set of job IDs from `page=1`; combines correctly with `since_days` (tested `since_days=30&page=2`) |

### Location parameters — none work

Probed live against `text=CTO` (baseline 190 results): `location=Berlin`, `city=Berlin`,
`ort=Berlin`, `standort=Berlin`, `region=Berlin`, `geocode[location]=Berlin` (and its
URL-encoded form), and `distance=25&geocode[location]=Berlin`. **None changed the
result count** — all returned the same 190-result unfiltered set. The AngularJS
search form uses `ng-model="searchCtrl.criteria.geocode.location"`, which is populated
by a JS-only autocomplete widget (`placeholder="Stadt oder PLZ"`) rather than a plain
URL parameter Experteer's server-rendered fallback recognizes.

Folding the city into `text` **does** work as a real filter: `text=CTO Berlin` (URL:
`?text=CTO%20Berlin`) returned 48 results vs. 190 for `text=CTO` alone — confirmed live.
This CLI documents that as the location workaround (see SKILL.md), the same pattern
`jobindex-search` and `stepstone-search` use.

### Response structure

Server-rendered HTML (Rails + AngularJS `ng-app="ExperteerApp"`). Each result is a:

```html
<div data-list-location='N' data-list-item-id='<numeric id>'
     class="job-list-item job-list-item-rebuild js-job-serp-item ...">
```

block. The CLI splits the page on `<div data-list-location=` and parses each chunk
independently (one malformed card can't break the rest).

Fields per card:

| Field | Where | Notes |
|-------|-------|-------|
| `id` | `data-list-item-id='...'` attribute | Numeric string, e.g. `59148463` |
| `title` | `.job-list-item-title a`'s `title="..."` attribute | HTML-entity decoded (e.g. `&amp;` → `&`) |
| `url` | Same `<a href="...">`, relative | Query string (`?signup_hook=...`) stripped; made absolute against `https://www.experteer.de` |
| `location` | `ga-event="B2C JobSearch JobTile; City Link Interaction; <CITY>"` attribute on the location `<span>` | Cleanest anchor — the visible `<span>` text needs whitespace trimming, the `ga-event` attribute is already clean |
| `date` | `.published-days-ago` div text, e.g. `"Vor 7 Tagen veröffentlicht"` | See "Relative date parsing" below |
| `company` | **Not present anywhere in the card markup** | See "Company is gated" below |

### Company is gated on search results

Every card's `.job-list-item-info` block carries only Function / Industry / Career
Level tags (`ga-event="...Filter Tag Interaction..."`) plus a
`.company-name-tooltip` widget whose only text is a generic "Sie wollen alle Stellen
in diesem Unternehmen sehen?" ("want to see all jobs at this company?") upsell with a
`js-unlock-company-filter` signup link — never the actual company name. Confirmed
across all 25 cards on multiple fetched pages. This CLI's `search` always returns
`company: null`; the real name is available via `detail` instead (see below).

### Relative date parsing

Experteer shows a coarse relative-age label per card, always one of:

- `"Vor N Tagen veröffentlicht"` for N in the observed range 1–29 (note: grammatically
  it's always "Tagen" even for `N=1`, e.g. `"Vor 1 Tagen veröffentlicht"` — a quirk of
  the site's own copy, not a parsing bug)
- `"Vor 30+ Tagen veröffentlicht"` — an open-ended bucket for anything 30 days or older

`parsePublishedDate()` in `helpers.ts` converts the exact-count form to an approximate
ISO date (`today - N days`) and returns `null` for the `30+` bucket, since no exact day
count is recoverable from it. It also defensively handles `"Heute"` (today) and
`"Gestern"` (yesterday) prefixes, though neither was observed live — the exact-count
buckets started at 1 in every sample fetched.

### Total count

`<h1 class="result-hits">190 Jobs für 'cto'</h1>` (filtered) or `<h1
class="result-hits">65.405 Jobs</h1>` (unfiltered — no query). German thousands
separators (`.`) are stripped before parsing to an integer. Exposed as `meta.total` in
this CLI's JSON output (in addition to the portal-skill contract's required
`meta.count`, which is the current page's result count).

## Detail

```
GET https://www.experteer.de/career/view-jobs/<slug-or-bare-id>
```

Confirmed live: a bare numeric ID alone (`/career/view-jobs/59148463`) resolves
directly to the job — no descriptive slug required. A completely wrong slug with the
correct trailing numeric ID (`/career/view-jobs/totally-wrong-slug-59148463`) 301s to
the canonical slug URL. A genuinely nonexistent ID returns HTTP 404. This CLI's
`detail` command builds `/career/view-jobs/<id>` directly from a bare ID rather than
depending on a caller-supplied slug — the same pattern `stepstone-search` uses.

### Response structure

The detail page is served from a **different, newer stack than search** — Next.js,
not the Rails+AngularJS search page. It embeds a schema.org `JobPosting` block as a
JSON string inside a hydration script:

```html
<script>(self.__next_s=self.__next_s||[]).push([0,{"type":"application/ld+json","children":"{...escaped JSON...}"}])</script>
```

`extractNextPushBlocks()` in `helpers.ts` finds every such `.push([...])` call on the
page (there are at least two — one `JobPosting`, one `Occupation` schema block with
salary-estimate/location metadata this CLI doesn't use) and parses each as JSON; the
outer array literal (`[0, {type, children}]`) is itself valid JSON even though it's
embedded inside a JS statement, so no JS evaluation is needed. `children` is a
JSON-escaped string containing the actual ld+json object, so it needs a second
`JSON.parse`.

Relevant `JobPosting` fields:

| Field | Maps to | Notes |
|-------|---------|-------|
| `title` | `title` | Plain string |
| `description` | `description` | **Plain text already** — confirmed no HTML tags, no entities (unlike most other portals in this repo, no tag-stripping or entity-decoding is needed; the CLI still runs it through `.trim()`) |
| `datePosted` | `date` | ISO date string, e.g. `"2026-08-28"` — exact, unlike search's relative-label approximation |
| `employmentType` | `employmentType` | Schema.org enum, e.g. `"FULL_TIME"` |
| `jobLocationType` | `workMode` | e.g. `"Hybrid"`, `"Remote"`, `"Onsite"` |
| `baseSalary.currency` + `.value.{minValue,maxValue,value}` + `.value.unitText` | `salary` | Formatted as `"EUR 70000-79999/year"` by `formatSalary()`; falls back to a single `value` if no min/max range is present |
| `hiringOrganization.name` | `company` | **The real company name — present and unguarded on the detail page**, even though the same job's search-result card hides it. Confirmed on multiple live postings (e.g. "Westfalen AG", "Operational Services"). |
| `jobLocation.address.addressLocality` | `location` | City only; `addressRegion` was `null` on every sample fetched |
| `industry` | `industry` | Free-text German industry label, e.g. `"Gaserzeugung"`, `"IT Beratung"` |
| `validThrough` | `deadline` | ISO date |

**No apply URL exists anywhere in the schema.** The visible "Jetzt bewerben" button on
the rendered page is a plain `<button type="button">` with no `href` or bound URL in
the markup — it triggers Experteer's own in-page account/application flow (confirmed:
no `signup`, `apply`, or similar URL-bearing attribute near the button in the fetched
HTML). `applyUrl` is always `null`; the detail page's own URL is the entry point for a
human to apply.

### Occasional missing hydration block

One fetch during testing (same job ID, re-fetched moments apart) returned a
96 KB variant of the page with zero `__next_s` push blocks, versus the normal ~159 KB
page that carries them — re-fetching the same URL immediately after returned the
normal page. Cause not identified (possibly a lighter bot-facing or cache-miss
variant); not reproduced a third time. `parseJobDetail()` returns `null` in this case
and `detail` surfaces it as `NOT_FOUND` rather than crashing — a caller hitting this
should simply retry.

## Notes

- No authentication required for `search` or `detail`.
- Honest User-Agent: `Mozilla/5.0 (compatible; experteer-search-cli/1.0)`.
- The CLI backs off on 429/5xx with jittered exponential backoff (max 6 retries);
  treats 404 as "not found" (empty search results, or `NOT_FOUND` for `detail`) rather
  than an error.
- Out-of-range search pages (e.g. `page=999` on a 190-result query) return HTTP 404
  for the whole page, not an empty-but-200 result list — `htmlFetch` maps that to `""`,
  which `parseSearchResults` correctly turns into zero results rather than an error.
- Verified live 2026-09-04 against `text=CTO` (190 results, used for all search/detail
  testing) — page 2 of that same query already surfaced German-language executive
  titles like "Geschäftsführer Textilindustrie (m/w/d)" in the results, confirming the
  portal indexes German executive titles alongside the English "CTO" query.
