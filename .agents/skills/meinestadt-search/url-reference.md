# meinestadt.de URL Reference

Public, unauthenticated pages on `jobs.meinestadt.de` (and one wrapper on `www.meinestadt.de`)
used by this skill. All findings below were verified live on 2026-09-04.

## robots.txt summary (checked live)

`https://jobs.meinestadt.de/robots.txt`, generic `User-agent: *` bucket (the one this CLI's
honest UA, `meinestadt-search-cli/1.0`, falls into — it matches no named token in the file):

```
Disallow: /*marktjagd_pageflip.html*
Disallow: /jobs-files/
Disallow: /coop/
Disallow: /redirect/
Disallow: /*/redirects/deutsche_bahn
Disallow: /*/videostellenanzeigen
Disallow: /*/ba-preview?id=
Disallow: /*?*cid=
Disallow: /*?*hsfp=
Disallow: /*?*lang=
Disallow: /*?*loc-interest=
Disallow: /*?*jobwrds=
Disallow: /*?*apsi/
Disallow: /suche*?*page=
Disallow: /*?*service=
Allow: /jobs-files/sitemap/... (several)

# separate block, dated 27.02.2025
Disallow: /*?page=
Disallow: /*&page=
```

`https://www.meinestadt.de/robots.txt` (same generic bucket), relevant line:

```
Disallow: /*?*redirectUrl
```

**Net effect for this CLI:**
- The listing pages (`/<city>/{jk,jkl}/<code>`), the native detail pages
  (`/<city>/{premium,standard}?id=<id>`), and the sitemap XML under `/sitemaps/` are **not**
  disallowed by any rule above — this CLI's core access pattern is robots.txt-compliant, no
  personal-use warning required (unlike linkedin-search/xing-search, which each hit an
  explicit `Disallow` on their search path).
- **Pagination is fully blocked**: `Disallow: /*?page=` and `Disallow: /*&page=` cover any
  path site-wide. `search --page 2` and above returns `PAGINATION_UNSUPPORTED` rather than
  requesting a disallowed URL.
- **The partner "apply" redirect wrapper is fully blocked**: `Disallow: /redirect/` on
  jobs.meinestadt.de, and separately `Disallow: /*?*redirectUrl` on www.meinestadt.de (where
  the wrapper's URL actually lives — see "Partner redirect listings" below).
  `detail` refuses these with `EXTERNAL_LISTING`.
- `Disallow: /*?*jobwrds=` also confirms `jobwrds` was once (or still is, for a UA outside
  this bucket) a real parameter — but it does not filter results for this CLI's bucket even
  where robots.txt would allow it (see next section), so it isn't used regardless.

## Why there is no free-text search

Tested live: `GET https://jobs.meinestadt.de/deutschland?jobwrds=CTO` returns **HTTP 200**
with the exact same total (`541.317` / `540.090`-ish, drifting slightly between requests)
and headline as `GET https://jobs.meinestadt.de/deutschland` with no query at all — the
parameter is accepted but does not filter anything. No other keyword parameter was found
after checking:
- The page's own search form (`<form class="o-jobsSearchbox" method="get">`): the keyword
  `<input>` has `name=""` (empty) in static markup — it's populated by a client-side
  autocomplete widget that resolves free text to a category, not submitted as raw text.
- The site's loaded JS bundle (`static.meinestadt.de/.../core/jobs.js`, ~2.9MB) — no
  `autosuggest`/`api`/`jobwrds`-handling endpoint string found in it (the autocomplete
  widget's own request logic is not in this bundle).

**Conclusion**: meinestadt.de's job search is fundamentally category+city browsing, not
free text. See "Category taxonomy resolution" below for how this CLI approximates a keyword
search against that taxonomy.

## Category taxonomy resolution (how `--query` works)

1. **Category index**: `GET https://jobs.meinestadt.de/sitemaps/jobs-jk-index.xml` — a
   sitemap index, ~293 `<loc>` entries, ~45KB, e.g.:
   ```
   <loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-geschaeftsfuehrer-vorstand-stadt.xml</loc>
   <loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-it-manager-it-projektleiter-stadt.xml</loc>
   <loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-softwareentwickler-programmierer-stadt.xml</loc>
   ```
   The filename slug (`jobs-<slug>-stadt.xml`) is the category's readable German name. This
   CLI transliterates the query (ä→ae, ö→oe, ü→ue, ß→ss, lowercase, non-alnum→hyphen — the
   same convention the portal's own slugs use) and requires every resulting word to appear
   as a substring of a candidate slug. Ties are broken by shortest slug (closest match).
   Verified matches: "CTO" → none; "Geschäftsführer" → `geschaeftsfuehrer-vorstand`;
   "Director" → none; "Manager" → `produktmanager`/`account-manager`/`it-manager-it-projektleiter`;
   "IT Manager" → `it-manager-it-projektleiter`; "Softwareentwickler" →
   `softwareentwickler-programmierer`; "Vertriebsleiter" → `vertriebsleiter-verkaufsleiter`.

2. **Category code**: `GET https://jobs.meinestadt.de/sitemaps/jk/jobs-<slug>-stadt.xml` —
   one sitemap per category, ~370KB, listing that category's URL for every city meinestadt
   covers, all sharing the **same numeric code** (city-independent):
   ```
   <loc>https://jobs.meinestadt.de/berlin/jkl/0-15214-15780</loc>
   <loc>https://jobs.meinestadt.de/hamburg/jkl/0-15214-15780</loc>
   <loc>https://jobs.meinestadt.de/muenchen/jkl/0-15214-15780</loc>
   ...
   ```
   This CLI regexes the first occurrence of `{jk|jkl}/<code>` from this file — one entry is
   enough, since the code is identical across every city line. Two taxonomy depths were
   observed in the wild: `jk/<id>` (single numeric id, top-level category, e.g.
   `/muenchen/jk/0-15777` for "Bürowesen") and `jkl/<id1>-<id2>` (category+subcategory pair,
   e.g. `0-15214-15780` for "Geschäftsführer & Vorstand"). Every category-index sitemap file
   checked during this build used the `jkl` (two-id) shape; this CLI handles both since it
   reads whichever segment name (`jk` or `jkl`) the sitemap actually uses rather than
   hardcoding one.

3. **Listing page**: `GET https://jobs.meinestadt.de/<city-slug>/{jk|jkl}/<code>` (or
   `/deutschland/...` for nationwide, the default). Confirmed live: `deutschland` + this
   category code returned real results (`numberOfItems: 1410`, 20 shown, `lastPage: 71`);
   `berlin` returned 129; `frankfurt-am-main` returned 133 (JSON-LD `numberOfItems`) vs. 57
   (the page's own `<span class="a-hitAmount__number">` text) for the same URL in the same
   fetch — **these two totals can disagree**; this CLI trusts the JSON-LD `numberOfItems`
   first, falling back to `a-hitAmount__number` only if no ld+json total is present, and
   surfaces whichever it used as `meta.total`. The discrepancy's root cause wasn't
   determined (possibly a difference between "core" paid-tier count vs. all-tiers count) —
   worth re-checking if `meta.total` looks off after a future markup change.

### City slugs

Transliterated the same way as category slugs (ä→ae, ö→oe, ü→ue, ß→ss). Confirmed from the
sitemap: `berlin`, `hamburg`, `muenchen`, `koeln`, `frankfurt-am-main`, `stuttgart`,
`leipzig`, `duesseldorf`, `dortmund`, `essen-ruhr`, `dresden`, `nuernberg`, `hannover`,
`duisburg`, `bochum`, `wuppertal`, `bielefeld`, `bonn`, `mannheim`, `karlsruhe`,
`muenster-westfalen`, `augsburg`, `wiesbaden`, `gelsenkirchen`. **Exception**: the city of
Bremen is `stadt-bremen`, not `bremen` (the bare slug is reserved for the federal state of
Bremen). `deutschland` is the nationwide pseudo-location this CLI defaults to. Only real,
recognized slugs return listings — an unrecognized `--location` value returns the same
"zero results" shape as an unmatched category (not an error).

## Search results page structure

Job cards live in `<li class="m-resultListEntryJobScan ..." data-component="resultListEntry-jobScan" data-position="N">`
blocks. This CLI chunks on that marker and parses each card independently (so one malformed
card can't break the rest). Per card:

| Selector | Field |
|----------|-------|
| `<a class="... m-resultListEntryJobScan__clickArea ..." href="...">` | `url` (also carries the id — see below) |
| `<h3 ...>` inside that anchor | `title` |
| `.m-resultListEntryJobScan__company` | `company` |
| `.m-resultListEntryJobScan__location` (after a leading `<i>` pin icon) | `location` |
| `.m-resultListEntryJobScan__date` (after a leading `<i>` clock icon) — text is inconsistent: real dates (`03.09.2026`), or the labels `"Neu"`/`"Aktualisiert"` | `date` |
| `[?&]id=(\d+)` on the href | `id` — works uniformly for native (`?id=`) and partner-redirect (`&id=` as the last param) links |

A page-level `<script type="application/ld+json">{"@type":"OfferCatalog",...}</script>`
block also carries the same items in schema.org `ItemList` shape (`name`, `description`
formatted as `"Job als <title> bei <company> in <location>"`, `url`, `position`) plus
`numberOfItems` (the total, used for `meta.total` — see above). This CLI does **not** parse
the ld+json for per-card fields (the per-card HTML gives a cleaner `date`/`company` split and
avoids parsing the `description` sentence), but it does read `numberOfItems` from it.

**Entity-escaping quirk**: the ld+json and `data-mst`/`data-jobs-mlm` attributes carry text
that has been HTML-entity-escaped *twice* (e.g. `Gesch&amp;auml;ftsf&amp;uuml;hrer` for
"Geschäftsführer" — the umlaut entity itself got re-escaped when the attribute value was
serialized). Visible text nodes (the `<h3>` title, company/location divs) are plain UTF-8
and need only a single decode pass. `decodeHtmlEntities` in `helpers.ts` is idempotent
(safe to run twice), used once for visible nodes.

## Partner redirect listings

Many results per page — commonly a majority in a city-scoped category (16 of 20 on the
Frankfurt "Geschäftsführer & Vorstand" page checked live) — are **not** native meinestadt
listings but a same-origin tracking wrapper on the `www.` subdomain:

```
https://www.meinestadt.de/<city>/redirect/jobs-redirect?redirectUrl=<opaque-token>&partner=<opaque-token>&id=<numeric-id>
```

This forwards to an external job board (the actual partner site is not resolvable without
following the redirect, which robots.txt disallows for this CLI's bucket — see the robots.txt
section above). Search results include these (reading data already present on a page this
CLI is allowed to crawl), flagged `isExternal: true` via `isExternalListing()` in
`helpers.ts` (checks for `/redirect/` in the path or `redirectUrl=` in the query string, so
it catches the wrapper regardless of which subdomain/path shape a future markup change uses).
`detail` refuses to fetch these (`EXTERNAL_LISTING`).

## Native detail pages

```
GET https://jobs.meinestadt.de/<city-slug>/premium?id=<id>
GET https://jobs.meinestadt.de/<city-slug>/standard?id=<id>
```

The city segment is **load-bearing**, not cosmetic (unlike StepStone's detail slug) — this
CLI requires the caller to pass the full URL from a `search` result rather than a bare ID.

### `premium` listings — schema.org JobPosting (strict JSON)

```html
<script type="application/ld+json">
{"title":"...", "description":"<ul>...</ul>", "hiringOrganization":"...",
 "datePosted":"2026-09-04", "validThrough":"2026-09-29",
 "employmentType":"Vollzeit oder Teilzeit",
 "jobLocation":{"address":{"addressLocality":"Frankfurt am Main", ...}},
 "baseSalary": {...}, "@type":"JobPosting", ...}
</script>
```

Confirmed live on `id=100013968203`: full, clean, strict JSON — the richest and most
reliable source on this portal. This CLI parses whichever `<script type="application/ld+json">`
block on the page has `"@type":"JobPosting"` (there can be multiple ld+json blocks on a
detail page — a `BreadcrumbList` and, on `standard` pages, an `OfferCatalog` of related jobs
— so this CLI scans all of them rather than assuming block order).

Field mapping: `title`→`title`, `hiringOrganization`→`company`, `datePosted`→`date`,
`validThrough`→`deadline`, `employmentType`→`employmentType`,
`jobLocation.address.addressLocality`→`location`, `description` (HTML)→`description`
(tags stripped, entities decoded, paragraph/list breaks kept as `\n`).

### `standard` listings — no JobPosting ld+json, HTML fallback

Confirmed live on `id=260203056`: the only ld+json blocks present are `OfferCatalog`
(related jobs) and `BreadcrumbList` — no `JobPosting` block at all. This CLI falls back to
the visible markup:

| Selector | Field |
|----------|-------|
| `<h1 ... data-component="headline" ...>` | `title` |
| `.ms-jobDetailHeader__companyName` | `company` |
| `.m-croppedList__content` (under the "Standort:" label) | `location` |
| `.ms-jobDetailStyledText` (`data-component="jobDetailStyledText"`) article | `description` (HTML → text) |
| First non-`"not_set"` `mslayer_element_detail_start_date` in a `data-mst="{&quot;...&quot;}"` attribute, format `YYYYMMDD` | `date` (sliced to `YYYY-MM-DD`) |

No reliable `employmentType` or `deadline` field was found for `standard` listings — both
are always `null` for this tier.

### Apply link

No resolvable external apply URL on **either** tier — the apply flow is an in-page
form/button (`headerSectionApplicationButton`) tied to a `data-mlm`/`data-jobs-mlm` action
id, not a redirect to an external or hosted form URL. `applyUrl` is always `null`; the
detail page's own URL is the entry point for a human to apply.

## Bot-protection quirk (Akamai)

`curl` (any User-Agent, including a full desktop Chrome string) gets an immediate **403
Forbidden** from `Server: AkamaiGHost` on **every** path tested, including the bare
homepage — this is TLS/HTTP-stack fingerprinting, not a User-Agent check (confirmed: a
byte-identical request differing only in the underlying HTTP client succeeds). **Bun's
native `fetch()`** (what this CLI uses) is **not** blocked — verified live, `bun run` with
this CLI's honest UA gets HTTP 200 consistently. This is documented here as a fragility
note, not a workaround to rely on: Akamai's fingerprinting could start blocking `bun fetch`
too without notice. Keep request volume low regardless (this CLI already does: one search
resolves to 3 requests — category index, category sitemap, listing page — plus one more per
`detail` call).

## Verification log

Verified live 2026-09-04 with User-Agent `Mozilla/5.0 (compatible; meinestadt-search-cli/1.0)`:
- `search -q "CTO"` → 0 results (no taxonomy match, as expected for an English abbreviation).
- `search -q "Geschäftsführer"` → resolved to category `geschaeftsfuehrer-vorstand`
  (`0-15214-15780`), nationwide total 1410, 20 results per page, real titles/companies/dates.
- `search -q "Geschäftsführer" -l "frankfurt am main"` → total 133, 4 native + 16 external
  (partner redirect) listings in the first page.
- `detail` on a native `premium` listing → full JobPosting fields, readable description.
- `detail` on a native `standard` listing → HTML-fallback fields, readable description, null
  `employmentType`/`deadline`.
- `detail` on a partner redirect listing → refused with `EXTERNAL_LISTING`, no request made.
