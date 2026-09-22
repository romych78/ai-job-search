# Michael Page Germany URL Reference

Public, unauthenticated job-search and job-detail pages used by this skill.

## Search

```
GET https://www.michaelpage.de/jobs?<params>
```

Query params (confirmed live against a "CTO" query, fetched 2026-09-04):

| Param | Meaning | Example | Confirmed how |
|-------|---------|---------|----------------|
| `search` | Free-text query (job title, skill, role) | `CTO` | The exposed search form's `<input name="search">`; `?q=CTO` was **not** the right param (returned unfiltered results) |
| `location` | Free-text place (city/region) | `Berlin` | The exposed form's `<input name="location">`; changed the result set live |
| `page` | 0-indexed page | `1` (= second page) | `page=1` 404s on a query with only 6 total results (fits on page 0); a broader query ("it") returns 30 results on both `page=0` and `page=1` |

Both `search` and `location` (alone or combined) trigger a **302 redirect** to a
friendly URL: `/jobs?search=CTO` -> `/jobs/cto`; `/jobs?search=IT&location=Berlin`
-> `/jobs/it/berlin`. `location` alone (no `search`) does **not** redirect — it
stays on `/jobs?location=Berlin` with a 200. This CLI always builds the
query-string form and lets `fetch`'s `redirect: "follow"` handle either case, so it
never needs to build the friendly-URL slug itself.

### Response structure

Plain server-rendered HTML (no SPA shell). Real result tiles:

```html
<div about="/job-detail/<slug>/ref/<ref>" class="job-tile search-job-tile[ featured-job]">
  <div class="job-title "><h3><a href="/job-detail/...">TITLE</a></h3></div>
  <div class="job-properties">
    <div class="job-location">LOCATION</div>
    <div class="job-contract-type">CONTRACT TYPE</div>   <!-- e.g. "Festanstellung" -->
    <div class="job-nature">WORK MODE</div>              <!-- e.g. "Home Office" — not always present -->
    <div class="job-salary">SALARY RANGE</div>           <!-- not always present -->
  </div>
  <div class="job-summary">...teaser text...</div>
  <div class="bullet_points">...benefit bullets...</div>
  <div class="job-links">...</div>
</div>
```

Each `<i class="fa...">` icon glyph inside these divs is stripped by this CLI's
field regex before the text.

**Recommendation padding on thin result sets.** A query with few real matches gets
appended (still inside the same results `<ul>`) with an
`<div class="other-users-also-applied-for-block"><h3>Andere Bewerber haben sich
auch auf diese Jobs beworben</h3><ul>...</ul></div>` block. Its tiles use the class
`job-tile recommended-job-tile search-job-tile` (note "recommended-job-tile" is
inserted **before** "search-job-tile", not after). This CLI's tile-anchor regex is
the literal `class="job-tile search-job-tile` prefix, which only matches real
result tiles — recommended tiles never match it, so no separate cut/filter step is
needed. Confirmed live: a "CTO" query showed `mp_search_job_count: 6` in the
response header and exactly 6 real tiles, with 5 additional recommended tiles
appended in the block above.

**No company name and no posting date anywhere in search-tile markup.** The real
hiring company is never shown at this stage (see Notes below); date is only
available on individual job-detail pages.

**Page size**: up to 30 results per page (`page=0` and `page=1` on a 411-result "it"
query each returned exactly 30 tiles).

**`mp_search_job_count` response header** carries an approximate total-match count
(e.g. `6` for "CTO", `411` for the broad, semantically-matched "it" query) — noted
here for a future maintainer, but not used by this CLI (`meta.count` in this CLI's
JSON output is simply the number of tiles parsed off the fetched page, after
`--limit`).

## Detail

```
GET https://www.michaelpage.de/job-detail/<slug>/ref/<ref>
```

Where `<slug>/ref/<ref>` is the value from a search result's `id` (or extracted
from its `url`). This is a Drupal URL alias requiring the **exact** slug+ref pair —
confirmed live:
- `/job-detail/<slug>` alone (no `/ref/<ref>`) -> 404
- `/job-detail/<ref>` alone -> 404
- `/job-detail/<wrong-slug>/ref/<real-ref>` -> 404 (no fuzzy redirect to the
  canonical URL, unlike some portals)
- `/job-detail/<slug>/ref/<ref>` (exact) -> 200

### Primary job fields

The primary job (not the "similar jobs" carousel further down the page, which
reuses similar-looking markup — see below) lives in one unique block:

```html
<div class="job-apply-block-container" about="/job-detail/<slug>/ref/<ref>">
  <div class="job-title"><h1 class="job-apply-job-title"><span>TITLE</span></h1></div>
  <div class="job-apply-fields">
    <span class="job-location">LOCATION</span>
    <span class="job-contract-type">CONTRACT TYPE</span>
    <span class="job-salary">SALARY RANGE</span>          <!-- not always present -->
    <span class="jaj-info-wrapper">...</span>             <!-- terminator this CLI's regex stops at -->
  </div>
</div>
```

Note the detail page's own title often differs from the search-card title — it's
suffixed with the location for SEO (e.g. search card `"Head of IT (wdm)"` vs.
detail page `"Head of IT (wdm) in Leipzig"`). This CLI uses the detail page's own
title in `detail` output; it does not try to reconcile the two.

**"Similar jobs" carousel.** The same detail page also embeds a swiper/carousel of
recommended jobs further down (`?ng-src=other-users-applied&ng-jn=job-detail` on
their links), using job-tile-ish markup that overlaps with — but isn't identical
to — the search-results tile format (e.g. no icon `<i>` tags inside its
`job-location`/`job-contract-type` divs). **Do not reuse the search-tile parser on
a detail page** — this CLI's detail parser anchors specifically on the unique
`job-apply-block-container` block to avoid ever reading a carousel entry.

### `application/ld+json` block

Every detail page also embeds a schema.org `JobPosting` block:

```html
<script type="application/ld+json">{"@context":"http://schema.org/","@type":"JobPosting", ...}</script>
```

Fields used by this CLI: `datePosted` (ISO date, e.g. `"2026-08-06"` — the only
place any date appears), `description` (the full assembled job description as
HTML, already combining all of the page's accordion sections — Firmenprofil /
Aufgabengebiet / Anforderungsprofil / Vergütungspaket — into one string),
`employmentType` (schema.org enum, e.g. `"FULL_TIME"` — used only as a fallback if
the German-language `job-contract-type` span is somehow missing), `baseSalary`
(`{currency, value: {minValue, maxValue, unitText}}`, used only as a fallback),
`jobLocation.address.addressLocality`, `hiringOrganization.name` (**always
`"Michael Page"`** — the agency, never the real end employer — see Notes).

**Parsing quirk: not strict JSON as-shipped.** The `description` value contains raw,
literal newline characters embedded directly in the JSON string (invalid per the
JSON spec — a strict `JSON.parse` throws `Invalid control character at: ...`). Fix:
trim the script content (it has a trailing literal newline after the closing `}`,
which must be removed *before* the newline-escaping step below, or it becomes
"Extra data" trailing garbage instead), then replace any remaining literal
`\r\n`/`\n`/`\r` characters with the escaped `\n` two-character sequence, then
`JSON.parse`. This mirrors the `:undefined` -> `:null` normalization
`xing-search/cli/src/helpers.ts` uses for a similarly "almost JSON" blob.

No `validThrough` (deadline) field exists in the ld+json — confirmed absent on a
live posting; `deadline` is always `null` in this CLI's `detail` output.

### Apply link

```
/job-apply/<slug>/ref/<ref>
```

(`href` seen on the detail page's own "Jetzt bewerben" button.) **Disallowed by
robots.txt** for the generic bucket (`Disallow: /job-apply/` and
`/*/job-apply/`) — this CLI constructs the URL from the job's own slug/ref and
reports it in `detail` output, but never fetches it.

## robots.txt (fetched live 2026-09-04)

Relevant excerpts (generic `User-agent: *` bucket; a separate, near-identical
bucket repeats most of these for `bingbot` specifically):

```
Disallow: /search/
Disallow: /*/search/
Disallow: /job-apply/
Disallow: /*/job-apply/
Disallow: /job-apply-external/
Disallow: /*/job-apply-external/
Disallow: /*?*salary_range*=
Disallow: /*?*field_job_salary_min=
Disallow: /*?*field_job_salary_max=
Disallow: /*?*contract=temp
Disallow: /*?*contract=permanent
Disallow: /*?*brand=MP
Disallow: /*?*item_per_pages
Disallow: /*?*company-type*=
Disallow: /*?*start-month*=
Disallow: /*?*placement-duration*=
Disallow: /*?*cts=true
Disallow: /taxonomy/term/*/*

# Allow legacy job browse URLs, but disallow search URLs with too many facets.
Allow: */browse/jobs/*/*/*/
Disallow: */jobs/*/*/*/
```

None of these disallow the paths this CLI uses:
- `/jobs?search=...&location=...&page=...` — not `/search/` (Drupal's generic
  site search, a different path), and none of the listed disallowed query
  parameters (`salary_range`, `contract=`, `brand=`, `item_per_pages`,
  `company-type`, `start-month`, `placement-duration`, `cts=true`) overlap with
  `search`/`location`/`page`.
- `/jobs/<term>` and `/jobs/<term>/<location>` (the friendly-URL redirect targets)
  — the `*/jobs/*/*/*/` disallow requires **three** path segments after `/jobs/`
  plus a trailing slash (a legacy faceted-browse URL shape); this CLI's redirect
  targets only ever have one or two segments and no trailing slash.
- `/job-detail/...` — not mentioned in either bucket's disallow list.

**Only `/job-apply/` and `/*/job-apply/` are disallowed** among the paths this
skill touches at all, and this CLI never fetches them (see "Apply link" above). No
personal-use-only warning is required for `search` or `detail`.

## Notes

- No authentication required for either search or detail.
- Honest User-Agent: `Mozilla/5.0 (compatible; michaelpage-search-cli/1.0)` — no
  crawler impersonation.
- The CLI backs off on 429/5xx with jittered exponential backoff (max 6 retries);
  treats 404 as "not found" rather than an error.
- **Real employer identity is withheld.** Michael Page is a retained/executive-
  search agency; job descriptions refer to the real employer only as "unser
  Mandant" / "our client". `hiringOrganization.name` in the ld+json is always
  literally `"Michael Page"`, never the real company — this CLI reports
  `company: null` rather than surfacing that agency name, to avoid a downstream
  CV/cover-letter workflow mistaking the recruiter for the employer.
- Country-specific to Germany — postings are a mix of German and English.
