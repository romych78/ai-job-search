// Data source: jobs.meinestadt.de's public, unauthenticated job-search and
// job-detail pages. meinestadt.de is a general German local-classifieds portal —
// unlike LinkedIn/StepStone/Indeed/Xing, it has **no free-text search URL
// parameter** that filters results (confirmed live: `?jobwrds=CTO` returns the
// same unfiltered listing as no query at all, and robots.txt disallows that
// parameter anyway). Job listings are organized by a fixed occupation/category
// taxonomy ("jk"/"jkl" codes) crossed with a city (or "deutschland" for
// nationwide). This CLI resolves `--query` to the closest matching category by
// fetching the portal's own sitemap index (`jobs-jk-index.xml`, ~293 entries)
// and substring-matching the query's words against each category's slug — see
// resolveCategory() below and url-reference.md for the full mechanism.
//
// robots.txt (checked live on jobs.meinestadt.de) does not disallow the paths
// this CLI uses (`/<city>/{jk,jkl}/<code>`, `/<city>/{premium,standard}?id=`,
// `/sitemaps/...`). It DOES disallow pagination (`Disallow: /*?page=` and
// `Disallow: /*&page=`, site-wide) and the partner "apply" redirect wrapper
// (`Disallow: /redirect/` on jobs.meinestadt.de; `Disallow: /*?*redirectUrl` on
// www.meinestadt.de, which is where the wrapper actually lives) — this CLI
// never requests either. See url-reference.md.

export const BASE_URL = "https://jobs.meinestadt.de"
export const USER_AGENT = "Mozilla/5.0 (compatible; meinestadt-search-cli/1.0)"
const CATEGORY_INDEX_URL = `${BASE_URL}/sitemaps/jobs-jk-index.xml`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML/XML with exponential backoff on 429/5xx. Returns "" on a 404. */
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
 * Transliterate German umlauts/ß the way meinestadt.de's own URL slugs do
 * (confirmed live against city and category slugs: "münchen" -> "muenchen",
 * "geschäftsführer" -> "geschaeftsfuehrer"), lowercase, and collapse anything
 * else into hyphens.
 */
export function transliterate(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug
}

/**
 * Best-effort city slug for the `--location` flag. Defaults to "deutschland"
 * (nationwide) when no location is given. Only exact slugs the portal
 * recognizes will actually resolve to real listings — this is a fixed list of
 * ~11,000 German cities/municipalities, not free text, so an unrecognized
 * location returns zero results rather than an error (same shape as a
 * category with no matches). One confirmed exception: the city of Bremen is
 * slugged "stadt-bremen" (not "bremen", which is reserved for the federal
 * state) — see url-reference.md.
 */
export function slugifyLocation(location?: string): string {
  if (!location || !location.trim()) return "deutschland"
  return transliterate(location) || "deutschland"
}

export interface CategoryMatch {
  slug: string
  sitemapUrl: string
}

/**
 * Fetch meinestadt's own category sitemap index (293 entries, ~45KB) and
 * find the occupation/category whose slug contains every word of the query
 * (transliterated, case-insensitive substring match on each word — e.g.
 * "IT Manager" -> ["it","manager"] matches slug "it-manager-it-projektleiter").
 * Ties are broken by shortest slug (closest/most specific match). Returns
 * `null` if no category matches (e.g. "CTO" has no German-taxonomy match) —
 * this is not an error, just zero results, since meinestadt's search is
 * category-based rather than true free text. See url-reference.md.
 */
export async function resolveCategory(query: string): Promise<CategoryMatch | null> {
  const words = transliterate(query)
    .split("-")
    .filter((w) => w.length > 0)
  if (words.length === 0) return null

  const xml = await htmlFetch(CATEGORY_INDEX_URL)
  const locs = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g)).map((m) => m[1])

  let best: { slug: string; sitemapUrl: string } | null = null
  for (const url of locs) {
    const file = url.split("/").pop() ?? ""
    const slug = file.replace(/^jobs-/, "").replace(/-stadt\.xml$/, "")
    if (words.every((w) => slug.includes(w))) {
      if (!best || slug.length < best.slug.length) best = { slug, sitemapUrl: url }
    }
  }
  return best
}

export interface CategoryCode {
  /** URL path segment used by the portal for this taxonomy depth: "jk" (single id) or "jkl" (category+subcategory). */
  segment: string
  /** The numeric code, e.g. "0-15214-15780" — city-independent, same across every city in the category's sitemap. */
  code: string
}

/**
 * Fetch a single category's per-city sitemap file (~370KB — every German
 * city meinestadt covers, all sharing the same numeric code) and pull the
 * `{jk|jkl}/<code>` pattern from the first URL. City-independent, so any line
 * gives the same code needed to build a listing URL for any other city.
 */
export async function resolveCategoryCode(sitemapUrl: string): Promise<CategoryCode | null> {
  const xml = await htmlFetch(sitemapUrl)
  const m = xml.match(/meinestadt\.de\/[a-z0-9-]+\/(jkl?)\/([0-9-]+)/)
  if (!m) return null
  return { segment: m[1], code: m[2] }
}

export function buildListingUrl(location: string | undefined, cat: CategoryCode): string {
  return `${BASE_URL}/${slugifyLocation(location)}/${cat.segment}/${cat.code}`
}

/** Convert a Unicode code point to a string, dropping out-of-range values instead of throwing. */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * meinestadt double-HTML-escapes text inside its `data-mst`/`data-jobs-mlm`
 * attributes (e.g. `Gesch&amp;auml;ftsf&amp;uuml;hrer` for "Geschäftsführer" —
 * the umlaut entity itself got escaped a second time when the attribute value
 * was serialized). Visible text nodes (h3 titles, company/location divs) are
 * plain UTF-8 and only need a single pass. This decoder is safe to run twice
 * on already-decoded text since a second pass over plain text is a no-op.
 */
export function decodeHtmlEntities(text: string): string {
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

function decodeHtmlEntitiesTwice(text: string): string {
  return decodeHtmlEntities(decodeHtmlEntities(text))
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Render a fragment of description HTML as readable plain text, keeping paragraph/list breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * True for meinestadt's partner "apply" redirect wrapper — a same-origin
 * tracking link (`/redirect/jobs-redirect?redirectUrl=...`) that forwards to
 * an external job board. robots.txt disallows this path (`/redirect/` on
 * jobs.meinestadt.de; `?*redirectUrl` on www.meinestadt.de, where the wrapper
 * actually resolves), so this CLI surfaces these in search results (reading
 * data already present on a page it's allowed to crawl) but refuses to fetch
 * them for `detail`.
 */
export function isExternalListing(url: string): boolean {
  return url.includes("/redirect/") || url.includes("redirectUrl=")
}

export interface JobCard {
  id: string | null
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  /** True for a partner "apply" redirect link — see isExternalListing(). `detail` cannot fetch these. */
  isExternal: boolean
}

export interface SearchPageResult {
  total: number
  results: JobCard[]
}

/**
 * Parse a listing page (`/<city>/{jk|jkl}/<code>`) by splitting on each
 * `<li ... data-component="resultListEntry-jobScan" ...>` card and parsing
 * fields independently, so one malformed card can't break the rest (see
 * parseJobCards() in linkedin-search/cli/src/helpers.ts for the pattern this
 * follows).
 */
export function parseSearchResults(html: string): SearchPageResult {
  const cardRe = /<li\s+class="m-resultListEntryJobScan[^>]*data-component="resultListEntry-jobScan"[\s\S]*?<\/li>/g
  const chunks = html.match(cardRe) ?? []

  const results: JobCard[] = chunks
    .map((chunk): JobCard | null => {
      const hrefMatch = chunk.match(/<a\s[^>]*class="[^"]*m-resultListEntryJobScan__clickArea[^"]*"[^>]*href="([^"]+)"/)
      const url = hrefMatch ? decodeHtmlEntitiesTwice(hrefMatch[1]) : null
      if (!url) return null

      const titleMatch = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)
      const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])) : ""

      const companyMatch = chunk.match(/m-resultListEntryJobScan__company">([\s\S]*?)<\/div>/)
      const company = companyMatch ? decodeHtmlEntities(stripTags(companyMatch[1])) || null : null

      const locationMatch = chunk.match(/m-resultListEntryJobScan__location">([\s\S]*?)<\/div>/)
      const location = locationMatch ? decodeHtmlEntities(stripTags(locationMatch[1])) || null : null

      const dateMatch = chunk.match(/m-resultListEntryJobScan__date">([\s\S]*?)<\/div>/)
      const date = dateMatch ? decodeHtmlEntities(stripTags(dateMatch[1])) || null : null

      const idMatch = url.match(/[?&]id=(\d+)/)
      const id = idMatch ? idMatch[1] : null

      return { id, title, company, location, date, url, isExternal: isExternalListing(url) }
    })
    .filter((c): c is JobCard => c !== null && c.title.length > 0)

  const ldTotal = html.match(/"numberOfItems":(\d+)/)
  const hitAmount = html.match(/a-hitAmount__number['"]?>(\d+)/)
  const total = ldTotal ? parseInt(ldTotal[1], 10) : hitAmount ? parseInt(hitAmount[1], 10) : results.length

  return { total, results }
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  /** `validThrough` from the JobPosting JSON-LD, premium listings only — null for standard listings and past-deadline-less ads. */
  deadline: string | null
  /** Always null — meinestadt's apply flow is an in-page action/form, not a resolvable external link, on both listing tiers checked live. */
  applyUrl: string | null
}

/**
 * Premium listings embed a full schema.org JobPosting as strict JSON in
 * `<script type="application/ld+json">` — the richest, most reliable source
 * (title, hiringOrganization, datePosted, validThrough, employmentType,
 * jobLocation.address.addressLocality, description as HTML). Standard
 * listings do NOT carry this block (confirmed live — their ld+json is only an
 * OfferCatalog of *related* jobs), so this returns null for those and
 * parseJobDetailStandard() below is used instead.
 */
function parseJobPostingLd(html: string): any {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1].trim())
      if (data && data["@type"] === "JobPosting") return data
    } catch {
      // try the next block
    }
  }
  return null
}

function parseJobDetailPremium(data: any, id: string, url: string): JobDetail {
  const locality =
    typeof data?.jobLocation?.address?.addressLocality === "string" ? data.jobLocation.address.addressLocality : null
  return {
    id,
    title: typeof data?.title === "string" && data.title ? data.title : "(untitled)",
    company: typeof data?.hiringOrganization === "string" && data.hiringOrganization ? data.hiringOrganization : null,
    location: locality,
    date: typeof data?.datePosted === "string" ? data.datePosted : null,
    url,
    isExternal: false,
    description: typeof data?.description === "string" ? htmlToText(data.description) : null,
    employmentType: typeof data?.employmentType === "string" ? data.employmentType : null,
    deadline: typeof data?.validThrough === "string" ? data.validThrough : null,
    applyUrl: null,
  }
}

/**
 * Standard (non-premium) listings have no JobPosting ld+json, so this parses
 * the visible detail-page markup instead: the `<h1>` title, the
 * `.ms-jobDetailHeader__companyName` span, the `.m-croppedList__content`
 * location list, the `.ms-jobDetailStyledText` description article, and the
 * posting date from the first non-"not_set" `mslayer_element_detail_start_date`
 * found in a `data-mst` attribute (format `YYYYMMDD`, sliced to `YYYY-MM-DD`).
 */
function parseJobDetailStandard(html: string, id: string, url: string): JobDetail {
  const titleMatch = html.match(/<h1[^>]*data-component="headline"[^>]*>([\s\S]*?)<\/h1>/)
  const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])) : "(untitled)"

  const companyMatch = html.match(/ms-jobDetailHeader__companyName">([\s\S]*?)<\/span>/)
  const company = companyMatch ? decodeHtmlEntities(stripTags(companyMatch[1])) || null : null

  const locationMatch = html.match(/m-croppedList__content">([\s\S]*?)<\/ul>/)
  const location = locationMatch ? decodeHtmlEntities(stripTags(locationMatch[1])) || null : null

  const descMatch = html.match(/data-component="jobDetailStyledText"[^>]*>([\s\S]*?)<\/article>/)
  const description = descMatch ? htmlToText(descMatch[1]) : null

  const dateMatch = Array.from(html.matchAll(/mslayer_element_detail_start_date&quot;:&quot;(\d{8}|not_set)/g)).find(
    (m) => m[1] !== "not_set",
  )
  const date = dateMatch ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}` : null

  return {
    id,
    title,
    company,
    location,
    date,
    url,
    isExternal: false,
    description,
    employmentType: null,
    deadline: null,
    applyUrl: null,
  }
}

export function parseJobDetail(html: string, id: string, url: string): JobDetail {
  const jobPosting = parseJobPostingLd(html)
  if (jobPosting) return parseJobDetailPremium(jobPosting, id, url)
  return parseJobDetailStandard(html, id, url)
}
