// Data source: www.stepstone.de's public, unauthenticated search and detail pages.
// Both embed a JSON blob inline (StepStone's own SSR hydration state,
// `window.__PRELOADED_STATE__[...]`) that we parse directly rather than
// scraping CSS classes — the search page's blob is strict JSON; the detail
// page's blob is a JS object literal with one unquoted top-level key (`props:`)
// whose *value* is strict JSON, so we locate that value specifically.
//
// robots.txt (checked live) disallows `/jobs/*?*` for the generic `User-Agent: *`
// bucket this CLI's honest UA falls into, except for one carved-out exception:
// `Allow: /jobs/*?q=*`. A further rule, `Disallow: /jobs/*?q*&*`, blocks adding
// any second query parameter alongside `q`. This CLI never constructs a search
// URL with more than the `q` parameter — see buildSearchUrl below and
// url-reference.md for the full robots.txt analysis (recency filtering and
// pagination both require a second parameter, so neither is supported).

export const BASE_URL = "https://www.stepstone.de"
export const USER_AGENT = "Mozilla/5.0 (compatible; stepstone-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

/**
 * StepStone's slug is cosmetic — confirmed live: `/jobs/completely-wrong-slug?q=...`
 * still returns real results for `q`, and `/jobs/<slug>` alone (no `q`) returns
 * effectively the same result set as `/jobs/<slug>?q=<the term the slug came
 * from>`. It's still generated from the query (not a fixed placeholder) so the
 * URL reads sensibly and stays close to what a browser would produce.
 */
export function slugify(query: string): string {
  const slug = query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "suche"
}

/**
 * Build the one search URL shape this CLI ever requests: `/jobs/<slug>?q=<query>`.
 * Deliberately takes no other parameters — StepStone's robots.txt allows exactly
 * this shape (`Allow: /jobs/*?q=*`) and disallows adding anything else alongside
 * `q` (`Disallow: /jobs/*?q*&*`). Recency and pagination params both require a
 * second parameter, so neither can be added here without violating robots.txt —
 * see the JOBAGE_UNSUPPORTED / PAGINATION_UNSUPPORTED errors in commands/search.ts.
 */
export function buildSearchUrl(query: string): string {
  return `${BASE_URL}/jobs/${slugify(query)}?q=${encodeURIComponent(query)}`
}

/**
 * Locate the first `{` after `marker` (searching from `from`) and return the
 * balanced JSON object that follows, tracking string/escape state so a `}`
 * inside a quoted string (routinely present in description/snippet text)
 * doesn't end the object early. Returns `null` if the marker or a parseable
 * object is not found.
 */
function extractJsonAfter(html: string, marker: string, from = 0): any {
  const markerIdx = html.indexOf(marker, from)
  if (markerIdx === -1) return null
  const openIdx = html.indexOf("{", markerIdx + marker.length)
  if (openIdx === -1) return null

  let depth = 0
  let inStr = false
  let esc = false
  let i = openIdx
  for (; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
    } else {
      if (c === '"') inStr = true
      else if (c === "{") depth++
      else if (c === "}") {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
  }
  const blob = html.slice(openIdx, i)
  try {
    return JSON.parse(blob)
  } catch {
    return null
  }
}

/**
 * The search-results page embeds strict JSON:
 * `window.__PRELOADED_STATE__["app-unifiedResultlist"] = {...};` — this is the
 * full app state React hydrates from, keyed straightforwardly (unlike the
 * detail page below), so a direct extraction works.
 */
export function extractResultlistState(html: string): any {
  return extractJsonAfter(html, 'window.__PRELOADED_STATE__["app-unifiedResultlist"] = ')
}

/**
 * The detail page embeds `window.__PRELOADED_STATE__.JobAdContent = {\n  props: {...}, ... }`
 * — a JS object literal with unquoted keys at the top level, NOT strict JSON
 * (unlike the search blob), so it can't be handed to JSON.parse whole. Its
 * `props` value, however, IS strict JSON and carries everything this CLI
 * needs. `props: ` also appears in several *other* `__PRELOADED_STATE__`
 * assignments on the same page (each component follows the same
 * `{props: {...}, ...}` shape) — scoping the search for `props: ` to start
 * only after the `JobAdContent = ` marker's index picks the right one, since
 * it's the next occurrence in document order.
 */
export function extractJobAdProps(html: string): any {
  const contentMarker = "window.__PRELOADED_STATE__.JobAdContent = "
  const contentIdx = html.indexOf(contentMarker)
  if (contentIdx === -1) return null
  return extractJsonAfter(html, "props: ", contentIdx)
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji) decode
 * correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Render a fragment of description HTML as readable plain text, keeping paragraph breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  /** Short plain-text preview StepStone shows on the results card. */
  snippet: string | null
}

export interface SearchPageResult {
  total: number
  results: JobCard[]
}

/**
 * Parse the search page via the `app-unifiedResultlist` state's
 * `searchResults.items` array — the same data StepStone's own React front end
 * renders from, so it isn't tied to CSS class names StepStone could rename.
 */
export function parseSearchResults(html: string): SearchPageResult {
  const state = extractResultlistState(html)
  const searchResults = state?.searchResults
  const items = searchResults?.items
  if (!Array.isArray(items)) {
    throw new Error(
      "Could not locate job results in the StepStone search page — the page markup may have changed.",
    )
  }

  const results: JobCard[] = items
    .map((it: any): JobCard => {
      const id = it?.id !== undefined && it?.id !== null ? String(it.id) : ""
      const title = typeof it?.title === "string" ? it.title : ""
      const relUrl = typeof it?.url === "string" ? it.url.split("?")[0] : ""
      return {
        id,
        title,
        company: typeof it?.companyName === "string" && it.companyName ? it.companyName : null,
        companyUrl: typeof it?.companyUrl === "string" && it.companyUrl ? it.companyUrl : null,
        location: typeof it?.location === "string" && it.location ? it.location : null,
        date: typeof it?.datePosted === "string" ? it.datePosted.slice(0, 10) : null,
        url: relUrl ? `${BASE_URL}${relUrl}` : id ? `${BASE_URL}/stellenangebote--job--${id}-inline.html` : "",
        snippet: typeof it?.textSnippet === "string" && it.textSnippet ? decodeHtmlEntities(it.textSnippet) : null,
      }
    })
    .filter((c) => c.id && c.title)

  const total = typeof searchResults?.meta?.total === "number" ? searchResults.meta.total : results.length
  return { total, results }
}

export interface JobDetail extends JobCard {
  description: string | null
  /** German employment-contract type as StepStone labels it, e.g. "Feste Anstellung". */
  contractType: string | null
  /** German work-mode label, e.g. "Homeoffice möglich, Vollzeit". */
  workType: string | null
  /** Alias for `contractType` — the generic field name the portal-skill contract expects. */
  employmentType: string | null
  /** StepStone job ads carry no application deadline field; always null. */
  deadline: string | null
  /** Always null — see Notes in SKILL.md (apply is an in-page action, not a separate link). */
  applyUrl: string | null
}

/**
 * Parse the detail page via the `JobAdContent` state's `props` object —
 * `listingHeader.listingData` for the header fields, `textSections` for the
 * full body (StepStone splits the description into titled sections, e.g.
 * "DER JOB", "YOU"; this joins them with their headings preserved as text).
 */
export function parseJobDetail(html: string, id: string): JobDetail {
  const props = extractJobAdProps(html)
  const listingData = props?.listingHeader?.listingData
  const meta = listingData?.metaData ?? {}

  const title =
    (typeof listingData?.title === "string" && listingData.title) ||
    (typeof props?.jobAdTitle === "string" && props.jobAdTitle) ||
    null
  const company =
    (typeof listingData?.companyData?.name === "string" && listingData.companyData.name) ||
    (typeof props?.companyCard?.name === "string" && props.companyCard.name) ||
    null
  const companyUrl =
    (typeof listingData?.companyData?.companyNameResultPageUrl === "string" &&
      listingData.companyData.companyNameResultPageUrl) ||
    null
  const location =
    (typeof meta?.location === "string" && meta.location) ||
    (typeof props?.jobAdLocation === "string" && props.jobAdLocation) ||
    null
  const date = typeof meta?.onlineDate === "string" ? meta.onlineDate.slice(0, 10) : null
  const contractType = typeof meta?.contractType === "string" ? meta.contractType : null
  const workType = typeof meta?.workType === "string" ? meta.workType : null

  let description: string | null = null
  if (Array.isArray(props?.textSections) && props.textSections.length > 0) {
    const parts = props.textSections
      .map((s: any) => {
        const heading = typeof s?.title === "string" && s.title ? `${s.title}\n` : ""
        const body = typeof s?.content === "string" ? htmlToText(s.content) : ""
        return `${heading}${body}`.trim()
      })
      .filter((s: string) => s.length > 0)
    description = parts.length > 0 ? parts.join("\n\n") : null
  }

  return {
    id,
    title: title ?? "(untitled)",
    company,
    companyUrl,
    location,
    date,
    url: `${BASE_URL}/stellenangebote--job--${id}-inline.html`,
    snippet: null,
    description,
    contractType,
    workType,
    employmentType: contractType,
    deadline: null,
    applyUrl: null,
  }
}
