# landing.jobs URL Reference

Public, unauthenticated endpoints used by this skill — all confirmed live and all
compliant with `robots.txt` (no personal-use warning needed; see the robots.txt section).

## robots.txt (fetched live, 2026-09-04)

```
User-agent: *
Disallow: /job_closed.html
Disallow: /backoffice/
Disallow: /employers/request_info
Disallow: /employers/request_source_access
Disallow: /employers/search
Disallow: /api/
Disallow: /jobs/search

Sitemap: https://landing.jobs/sitemap.xml
```

Neither `sitemap.xml` nor `/at/<company>/<job>` (the job-detail path) appears in the
disallow list — both are the paths this CLI uses. `/jobs/search` (the site's actual
keyword-search endpoint, confirmed to also back `/jobs/search.json`) **is** disallowed;
this CLI never calls it.

## Why not the obvious search page?

- `GET https://landing.jobs/jobs?query=<text>` — the human-facing search UI. Returns 200
  with a real HTML page, but the results container
  (`<div id="jobs-list-results" data-server-rendered="true">`) is **empty** in the raw
  response — it's a client-side React shell that populates itself via a JS `fetch()` to
  `/jobs/search.json`, confirmed by finding that literal path string in an inline
  `<script>` block. Since the actual data lives behind the disallowed endpoint, this page
  is not usable as a search source even though the page itself is technically not
  disallowed.
- `GET https://landing.jobs/jobs/for/<skill>` (and `/jobs/in/<city>/for/<skill>`) —
  server-rendered tag pages (`<article class="lj-jobcard-static">` cards, full data, no
  JS needed) for the site's fixed skill taxonomy (e.g. `python`, `java`, `javascript`,
  `back-end-developer`). **Not disallowed**, and genuinely useful for the tags it knows
  about — but for a tag outside its taxonomy, it does **not** return zero results or an
  error. Confirmed live:
  - `/jobs/for/cto` → 200, 1 result, unrelated to "CTO" as a job title (a DBA posting
    whose description happens to mention the acronym "CTO" once).
  - `/jobs/for/vp-engineering` → 200, 50 results — the site's full unfiltered job listing,
    silently ignoring the unrecognized tag.
  This makes the tag-page mechanism unsafe as a general-purpose `--query` implementation:
  a caller can't distinguish "genuinely no jobs for this skill" from "tag not recognized,
  here's everything" from the HTTP response alone.

## Search index: sitemap.xml

```
GET https://landing.jobs/sitemap.xml
```

Single `<urlset>` (not a sitemap index) with ~2,258 `<url>` entries at the time this
skill was built, covering marketing pages, blog posts, predefined skill/location tag
pages (`/jobs/for/<skill>`, `/jobs/in/<city>/for/<skill>` — ~1,176 of them), and job
postings. Each `<url>` block:

```xml
<url>
  <loc>https://landing.jobs/at/we-are-meta/staff-python-engineer</loc>
  <changefreq>monthly</changefreq>
  <lastmod>2026-09-01</lastmod>
</url>
```

This CLI keeps only `<loc>` values matching
`^https://landing\.jobs/at/([^/]+)/([^/]+)$` — exactly two path segments after `/at/`.
A single segment (`/at/<company>`) is a company profile page, not a job posting, and is
discarded. At the time this skill was built, ~66 entries matched this pattern.

- **`--query` matching**: done client-side against `<companySlug> <jobSlug>` with
  hyphens replaced by spaces, lowercased. Every whitespace-separated word in the query
  must match as a **whole word** (`\b`-bounded) somewhere in that string. Job titles are
  almost always embedded in the slug (e.g. `staff-python-engineer`,
  `senior-java-developer-in-lisbon-2026`), so title/skill queries work well; queries for
  terms that only appear in the job description (not the title) will not match.
- **`<lastmod>` is not a reliable posting-date proxy.** Confirmed live: the posting at
  `/at/inscale/senior-java-software-developer-in-lisbon-2025` has `created_at:
  "2025-02-26"` (per its detail page's embedded JSON) but a sitemap `<lastmod>` of
  `2026-09-02` — over a year later. The site appears to bump `<lastmod>` on some
  unrelated cadence (e.g. a periodic resitemap regeneration) rather than on actual content
  changes. This CLI uses `<lastmod>` only to order *which* matching candidates to fetch
  first when there are more matches than the internal fetch cap — never to filter by age.

## Job detail

```
GET https://landing.jobs/at/<company-slug>/<job-slug>
```

Server-rendered HTML. The visible markup uses `lj-job-summary__*` BEM classes (title,
company, location, contract, category, experience, skills, description sections) and is
usable, but this CLI instead parses a richer embedded JSON blob:

```html
<div data-react-class="jobPage/JobPage" data-react-props="{&quot;jobAd&quot;:{&quot;id&quot;:&quot;19711&quot;,&quot;type&quot;:&quot;job_ad&quot;,&quot;attributes&quot;:{ ... }}}"></div>
```

The `data-react-props` attribute value is HTML-entity-encoded JSON (React-on-Rails
convention). Decode HTML entities once, then `JSON.parse`. Path to the fields this CLI
uses: `.jobAd.attributes`.

Relevant `attributes` fields (confirmed live against multiple postings):

| Field | Notes |
|-------|-------|
| `title` | Plain string |
| `company_name` | Plain string, e.g. `"We are META"`, `"Accenture"` |
| `location` | Human-readable, e.g. `"Portugal"` (remote/country-level) or `"Lisbon, Portugal"` (city-specific) |
| `office_locations` | Array of `{city?, country_code, label, google_place_id}` — `location` is the friendlier flattened form, used instead |
| `created_at` | ISO timestamp — original posting date. Used as this CLI's `date` field |
| `last_published_at` / `updated_at` | Also present; not used (`created_at` is closer to "posted date") |
| `job_type` | e.g. `"Permanent"`, `"Permanent / Contractor"` |
| `category` | Role category, e.g. `"Back-end Developer"`, `"AI"` |
| `experience_label` | e.g. `"Senior"` |
| `remote_working_label` | e.g. `"Remote"`, `"Hybrid"` |
| `role_description` | Full HTML description (role, requirements, nice-to-have, perks all concatenated) — see decoding note below |
| `must_have_skills` / `nice_to_have_skills` | Arrays of `{id, name}` — not currently surfaced in CLI output, available if needed |
| `urls` / `share_urls` | `null` on every posting checked — no external apply URL is exposed in public job data; landing.jobs handles applications on-site |
| `slug` | Matches the job-slug segment of the URL |

### `role_description` is double-HTML-escaped

Printing `role_description` directly (after the outer `data-react-props` decode +
`JSON.parse`) shows real HTML tags (`<div>`, `<strong>`, `<ul>`, `<li>`, `<br>`)
**mixed with** literal entity sequences like `&lt;!--block--&gt;` and `&quot;Rhinos&quot;`
that have **not** yet been decoded. This CLI's `renderDescription` decodes entities
*first* (turning `&lt;!--block--&gt;` into a literal `<!--block-->` HTML comment and
`&quot;` into `"`), *then* converts `<br>`/closing block tags to newlines, *then* strips
all remaining tags (which now correctly removes the materialized `<!--block-->`
comments too). Doing this in the opposite order (strip first, decode after — the
approach that works for singly-escaped HTML on other portals) leaves the decoded
`<!--block-->` markers behind as visible text in the output.

## robots.txt-compliance summary

| Path this CLI fetches | In `Disallow` list? |
|---|---|
| `https://landing.jobs/sitemap.xml` | No |
| `https://landing.jobs/at/<company>/<job>` | No |
| `https://landing.jobs/jobs/search`, `/jobs/search.json` | **Yes** — never called |
| `https://landing.jobs/jobs/for/<skill>` | No, but not used (unreliable fallback behavior for unrecognized tags — see above) |
| `https://landing.jobs/api/*` | **Yes** — never called |

No bot-protection challenge (Cloudflare-fronted, but no JS challenge page) was
encountered on any of these paths with a plain, honestly-identified `fetch()`.
